import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Prisma } from '@prisma/client';
import type { Queue } from 'bullmq';
import { JOB_OPTIONS, QUEUES } from '../../config/queue.config';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessScope } from '../auth/access-scope.service';
import type { AuthPayload } from '../auth/auth.types';
import { format, platform } from '../platforms/platforms.catalog';
import { LLM_PROVIDER_TOKEN, type LlmProviderPort } from '../llm/llm-provider.port';
import {
  DRAFT_HINT,
  DraftContentSchema,
  buildDraftSystemPrompt,
  buildDraftUserPrompt,
  type DraftContent,
} from './drafts.prompt';

/**
 * Borradores: se generan **solo cuando el humano lo pide**.
 *
 * Nunca salen del pipeline automático, y esto no es un detalle de implementación: es
 * la regla del proyecto (ADR-001/003). El coach sugiere; publicar —y redactar— lo
 * decide la persona. Por eso no hay borradores "de regalo" ni al crear una idea.
 *
 * Regenerar crea una **versión nueva**: si el usuario ya editó la anterior
 * (`editedByUser`), su texto no se pisa.
 */
export interface DraftOutcome {
  ideaId: string;
  draftId: string | null;
  version: number;
  usedLlm: boolean;
  skipped?: string;
}

@Injectable()
export class DraftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessScope,
    @Inject(LLM_PROVIDER_TOKEN) private readonly llm: LlmProviderPort,
    @InjectQueue(QUEUES.DRAFT) private readonly draftQueue: Queue,
  ) {}

  /**
   * Encola la generación (botón "Escribime un borrador").
   *
   * Sin `jobId` a propósito: es un pedido **manual** y cada uno tiene que correr. Un
   * id derivado del reloj parecía suficiente y no lo era (dos clics en el mismo
   * milisegundo daban el mismo id y BullMQ se comía el segundo, en silencio). El
   * único encolado que deduplica es el del análisis, y ahí es deliberado.
   */
  async requestGeneration(ideaId: string): Promise<void> {
    await this.draftQueue.add('draft', { ideaId }, JOB_OPTIONS);
  }

  async generateForIdea(ideaId: string): Promise<DraftOutcome> {
    const idea = await this.prisma.contentIdea.findUnique({
      where: { id: ideaId },
      include: {
        profile: { include: { accounts: { select: { platform: true } } } },
        signals: { include: { signal: true } },
      },
    });

    if (!idea) {
      return { ideaId, draftId: null, version: 0, usedLlm: false, skipped: 'La idea no existe.' };
    }

    const signals = idea.signals.map((link) => ({
      title: link.signal.title,
      summary: link.signal.summary,
      url: link.signal.canonicalUrl ?? link.signal.url,
    }));

    const llmResult = await this.llm.json({
      system: buildDraftSystemPrompt(),
      user: buildDraftUserPrompt({
        profile: {
          name: idea.profile.name,
          niche: idea.profile.niche,
          audience: idea.profile.audience,
          voice: idea.profile.voice,
          language: idea.profile.language,
        },
        idea: {
          title: idea.title,
          hook: idea.hook,
          angle: idea.angle,
          whyNow: idea.whyNow,
          platform: idea.platform,
          format: idea.format,
          hashtags: idea.hashtags,
        },
        signals,
      }),
      schema: DraftContentSchema,
      hint: DRAFT_HINT,
      task: 'draft-piece',
    });

    const content: DraftContent = llmResult
      ? normalizeContent(llmResult.data)
      : templateContent(idea, signals.length);

    const previous = await this.prisma.contentDraft.findFirst({
      where: { ideaId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });

    const draft = await this.prisma.contentDraft.create({
      data: {
        ideaId,
        content: content as unknown as Prisma.InputJsonValue,
        language: idea.profile.language,
        version: (previous?.version ?? 0) + 1,
      },
      select: { id: true, version: true },
    });

    if (llmResult) {
      await this.prisma.coachRun.create({
        data: {
          profileId: idea.profileId,
          job: 'draft',
          model: llmResult.meta.model,
          tokensIn: llmResult.meta.usage.inputTokens,
          tokensOut: llmResult.meta.usage.outputTokens,
          costUsd: llmResult.meta.costUsd,
          latencyMs: llmResult.meta.latencyMs,
        },
      });
    }

    // El estado de la idea NO cambia al generar un borrador: no hay estado
    // "borrador" y tampoco hace falta (el borrador es hijo de la idea, y la relación
    // ya lo dice). Si el estado fuera un espejo de la existencia del borrador, tarde
    // o temprano quedaría desincronizado.
    return { ideaId, draftId: draft.id, version: draft.version, usedLlm: llmResult !== null };
  }

  /** El usuario edita el borrador: se marca para que una regeneración no lo pise. */
  async update(user: AuthPayload, draftId: string, content: DraftContent) {
    await this.get(user, draftId);

    return this.prisma.contentDraft.update({
      where: { id: draftId },
      data: {
        content: parseContent(content) as unknown as Prisma.InputJsonValue,
        editedByUser: true,
      },
    });
  }

  async get(user: AuthPayload, draftId: string) {
    const draft = await this.prisma.contentDraft.findFirst({
      where: { id: draftId, idea: { profile: this.access.profileWhere(user) } },
      include: { idea: { select: { id: true, title: true, platform: true, format: true, status: true } } },
    });
    if (!draft) throw new NotFoundException(`El borrador ${draftId} no existe.`);
    return draft;
  }
}

/** Los `default` del contrato pueden no venir: se completan antes de guardar. */
function normalizeContent(raw: DraftContent): DraftContent {
  return {
    caption: raw.caption,
    script: raw.script ?? '',
    hookVariants: raw.hookVariants ?? [],
    cta: raw.cta ?? '',
    notes: raw.notes ?? '',
  };
}

/** Lo mismo para lo que edita el usuario (el body se valida en el controlador). */
function parseContent(input: DraftContent): DraftContent {
  return normalizeContent(input);
}

/**
 * Respaldo sin IA: arma el borrador con lo que la idea ya trae.
 *
 * No inventa datos: usa el gancho y el enfoque de la idea y deja el guion vacío (un
 * guion sin material real sería relleno). Queda claro en `notes` que es una plantilla.
 */
function templateContent(
  idea: {
    title: string;
    hook: string;
    angle: string;
    platform: string;
    format: string;
    hashtags: string[];
  },
  signalCount: number,
): DraftContent {
  const platformDef = platform(idea.platform as never);
  const formatDef = format(idea.format as never);
  const hashtags = idea.hashtags.length > 0 ? `\n\n${idea.hashtags.map((tag) => `#${tag.replace(/^#/, '')}`).join(' ')}` : '';

  return {
    caption: `${idea.hook}\n\n${idea.angle}${hashtags}`,
    script: formatDef.isVideo
      ? `[Gancho — primeros segundos]\n${idea.hook}\n\n[Desarrollo]\n${idea.angle}\n\n[Cierre]\nContá el resultado concreto y qué sigue.`
      : '',
    hookVariants: [idea.hook],
    cta: 'Si querés, te cuento el detalle en los comentarios.',
    notes:
      `Borrador de plantilla (no lo escribió la IA): está armado con el gancho y el enfoque de la idea. ` +
      `Se apoya en ${signalCount} señal(es). Revisá el tono para ${platformDef.label} y completá el guion con tu material.`,
  };
}
