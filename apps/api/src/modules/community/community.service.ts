import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { IdeaStatus, type Prisma } from '@prisma/client';
import type { Queue } from 'bullmq';
import { JOB_OPTIONS, QUEUES } from '../../config/queue.config';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessScope } from '../auth/access-scope.service';
import type { AuthPayload } from '../auth/auth.types';
import { LLM_PROVIDER_TOKEN, type LlmProviderPort } from '../llm/llm-provider.port';
import { NotificationsService } from '../notifications/notifications.service';
import type { AudienceSegmentsContent } from './community.prompt';
import {
  AudienceSegmentsSchema,
  SEGMENTS_HINT,
  buildSegmentsSystemPrompt,
  buildSegmentsUserPrompt,
  formatSegmentsForPrompt,
} from './community.prompt';
import type { SegmentInput, SegmentListQuery, SegmentPatch } from './community.schema';

/**
 * Coach de comunidad — audiencia.
 *
 * Por qué la audiencia vive acá y no en el perfil: es el objeto que el coach de comunidad
 * PRODUCE y que el coach de contenido CONSUME. Ponerlo en un servicio propio es lo que
 * permite que los prompts de ideas, borradores y reporte reciban exactamente el mismo
 * material, con una sola definición.
 *
 * Dos reglas de convivencia que importan:
 *  1. **Lo que toca el humano nunca se pisa**: si edita o archiva un segmento, queda
 *     `manual` y la próxima propuesta de IA no lo archiva.
 *  2. **Sin materia prima no se propone**: un perfil sin nicho ni audiencia declarada
 *     recibe un aviso, no cuatro segmentos inventados.
 */

export interface ProposeSegmentsOutcome {
  profileId: string;
  created: number;
  archived: number;
  usedLlm: boolean;
  skipped?: string;
}

@Injectable()
export class CommunityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessScope,
    private readonly notifications: NotificationsService,
    @Inject(LLM_PROVIDER_TOKEN) private readonly llm: LlmProviderPort,
    @InjectQueue(QUEUES.COMMUNITY) private readonly queue: Queue,
  ) {}

  async listSegments(user: AuthPayload, profileId: string, query: SegmentListQuery) {
    await this.access.assertProfile(user, profileId);

    const includeArchived = query.includeArchived === 'true';

    return this.prisma.audienceSegment.findMany({
      where: { profileId, ...(includeArchived ? {} : { archivedAt: null }) },
      orderBy: [{ archivedAt: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * Alta (o corrección) a mano.
   *
   * Upsert por nombre a propósito: si el usuario reescribe un segmento que había propuesto
   * la IA, ese nombre queda `manual` y desde ahí es suyo.
   */
  async createSegment(user: AuthPayload, profileId: string, input: SegmentInput) {
    await this.access.assertProfile(user, profileId);

    const data = {
      description: input.description,
      pains: input.pains,
      desires: input.desires,
      objections: input.objections,
      channels: input.channels,
      languageTips: input.languageTips ?? null,
      evidence: ['Lo escribiste vos.'] as Prisma.InputJsonValue,
      source: 'manual',
      archivedAt: null,
    };

    return this.prisma.audienceSegment.upsert({
      where: { profileId_name: { profileId, name: input.name } },
      update: data,
      create: { profileId, name: input.name, ...data },
    });
  }

  async patchSegment(user: AuthPayload, profileId: string, segmentId: string, patch: SegmentPatch) {
    await this.access.assertProfile(user, profileId);

    const segment = await this.prisma.audienceSegment.findFirst({
      where: { id: segmentId, profileId },
      select: { id: true },
    });
    if (!segment) throw new NotFoundException(`El segmento ${segmentId} no existe.`);

    return this.prisma.audienceSegment.update({
      where: { id: segmentId },
      data: {
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.description === undefined ? {} : { description: patch.description }),
        ...(patch.pains === undefined ? {} : { pains: patch.pains }),
        ...(patch.desires === undefined ? {} : { desires: patch.desires }),
        ...(patch.objections === undefined ? {} : { objections: patch.objections }),
        ...(patch.channels === undefined ? {} : { channels: patch.channels }),
        ...(patch.languageTips === undefined ? {} : { languageTips: patch.languageTips }),
        ...(patch.archived === undefined ? {} : { archivedAt: patch.archived ? new Date() : null }),
        // Cualquier intervención humana marca el segmento como suyo (editado o archivado):
        // así la IA no lo archiva en la próxima propuesta.
        source: 'manual',
      },
    });
  }

  /** Los segmentos activos en texto, para los prompts de los otros coaches. */
  async segmentsForPrompt(profileId: string): Promise<string[]> {
    const segments = await this.prisma.audienceSegment.findMany({
      where: { profileId, archivedAt: null },
      orderBy: { createdAt: 'asc' },
    });

    return formatSegmentsForPrompt(segments);
  }

  /** Pedido manual de propuesta: sin `jobId`, cada clic corre (regla del proyecto). */
  async requestPropose(profileId: string): Promise<void> {
    await this.queue.add('segments-propose', { profileId }, JOB_OPTIONS);
  }

  async runPropose(profileId: string): Promise<ProposeSegmentsOutcome> {
    const profile = await this.prisma.profile.findUnique({
      where: { id: profileId },
      select: {
        id: true,
        name: true,
        niche: true,
        audience: true,
        voice: true,
        language: true,
        objectives: { select: { metric: true, targetValue: true } },
      },
    });

    if (!profile) {
      return { profileId, created: 0, archived: 0, usedLlm: false, skipped: 'El perfil no existe.' };
    }

    // Sin materia prima no se inventa una audiencia (y no se gasta IA en inventarla).
    if (profile.niche.length === 0 && !profile.audience) {
      await this.notifyQuietly(profileId, {
        title: `No se puede proponer audiencia para ${profile.name}`,
        body:
          'El perfil no tiene nicho ni audiencia declarada. Completá al menos uno en «Perfiles»: ' +
          'la propuesta tiene que salir de algo tuyo, no de la nada.',
      });

      return {
        profileId,
        created: 0,
        archived: 0,
        usedLlm: false,
        skipped: 'El perfil no tiene nicho ni audiencia declarada.',
      };
    }

    const [signals, published, existing] = await Promise.all([
      this.prisma.profileSignal.findMany({
        where: { profileId, scoredAt: { not: null } },
        orderBy: { relevanceScore: 'desc' },
        take: 8,
        include: { signal: { select: { title: true } } },
      }),
      this.prisma.contentIdea.findMany({
        where: { profileId, status: IdeaStatus.PUBLISHED },
        orderBy: { publishedAt: 'desc' },
        take: 10,
        select: { title: true, platform: true },
      }),
      this.prisma.audienceSegment.findMany({
        where: { profileId, archivedAt: null },
        select: { name: true },
      }),
    ]);

    const llmResult = await this.llm.json({
      system: buildSegmentsSystemPrompt(),
      user: buildSegmentsUserPrompt({
        profile: {
          name: profile.name,
          niche: profile.niche,
          audience: profile.audience,
          voice: profile.voice,
          language: profile.language,
          objectives: profile.objectives.map(
            (objective) => `${objective.metric} → ${objective.targetValue}`,
          ),
        },
        signals: signals.map((row) => ({ title: row.signal.title, score: row.relevanceScore })),
        published,
        existing: existing.map((segment) => segment.name),
      }),
      schema: AudienceSegmentsSchema,
      hint: SEGMENTS_HINT,
      task: 'community-segments',
    });

    const content: AudienceSegmentsContent = llmResult
      ? normalizeSegments(llmResult.data)
      : templateSegments(profile);
    const source = llmResult ? 'ia' : 'plantilla';

    // Se archiva lo anterior de la IA; los segmentos que tocó el humano quedan intactos.
    const archived = await this.prisma.audienceSegment.updateMany({
      where: { profileId, archivedAt: null, source: { in: ['ia', 'plantilla'] } },
      data: { archivedAt: new Date() },
    });

    let created = 0;
    for (const segment of content.segments) {
      // El contenido va aparte de la procedencia: en un upsert, `source` solo se escribe al
      // CREAR. Así un segmento que el humano corrigió no vuelve a figurar como de la IA.
      const body = {
        description: segment.description,
        pains: segment.pains,
        desires: segment.desires,
        objections: segment.objections,
        channels: segment.channels,
        languageTips: segment.languageTips || null,
        evidence: segment.basedOn as Prisma.InputJsonValue,
        archivedAt: null,
      };

      await this.prisma.audienceSegment.upsert({
        where: { profileId_name: { profileId, name: segment.name } },
        update: body,
        create: { profileId, name: segment.name, ...body, source },
      });
      created += 1;
    }

    if (llmResult) {
      await this.prisma.coachRun.create({
        data: {
          profileId,
          job: 'community-segments',
          model: llmResult.meta.model,
          tokensIn: llmResult.meta.usage.inputTokens,
          tokensOut: llmResult.meta.usage.outputTokens,
          costUsd: llmResult.meta.costUsd,
          latencyMs: llmResult.meta.latencyMs,
        },
      });
    }

    await this.notifyQuietly(profileId, {
      title: `Audiencia propuesta para ${profile.name}`,
      body:
        `${created} segmento(s) nuevo(s) revisables en la pestaña Comunidad. ` +
        (llmResult
          ? 'Revisalos y corregí lo que no cierre: lo que edites queda tuyo.'
          : 'Armado con la plantilla (no hay proveedor de IA): completalo a mano.'),
    });

    return {
      profileId,
      created,
      archived: archived.count,
      usedLlm: llmResult !== null,
    };
  }

  /** El aviso es un extra: no puede tumbar la propuesta ya guardada. */
  private async notifyQuietly(profileId: string, content: { title: string; body: string }): Promise<void> {
    try {
      await this.notifications.notify({
        type: 'INFO',
        profileId,
        title: content.title,
        body: content.body,
      });
    } catch {
      // fail-soft a propósito.
    }
  }
}

function normalizeSegments(raw: AudienceSegmentsContent): AudienceSegmentsContent {
  return {
    segments: raw.segments.map((segment) => ({
      name: segment.name.trim().slice(0, 120),
      description: segment.description,
      pains: segment.pains ?? [],
      desires: segment.desires ?? [],
      objections: segment.objections ?? [],
      channels: segment.channels ?? [],
      languageTips: segment.languageTips ?? '',
      basedOn: segment.basedOn ?? [],
    })),
  };
}

/**
 * Respaldo sin IA: un segmento armado con lo que el perfil YA declaró.
 *
 * Es pobre a propósito y así se declara (`plantilla`): el valor de esta feature está en
 * deducir lo que no está escrito, y eso sin modelo no se puede. Lo que sí se puede es no
 * dejar la pestaña vacía y decir de dónde salió.
 */
export function templateSegments(profile: {
  name: string;
  audience: string | null;
  niche: string[];
}): AudienceSegmentsContent {
  const audience = profile.audience?.trim();

  return {
    segments: [
      {
        name: audience ? audience.slice(0, 60) : 'Público por definir',
        description:
          audience ??
          `El perfil ${profile.name} todavía no declaró su audiencia: esto es un punto de partida para editar.`,
        pains: [],
        desires: [],
        objections: [],
        channels: [],
        languageTips: '',
        basedOn: [
          ...(audience ? ['El texto de audiencia del perfil.'] : []),
          ...(profile.niche.length > 0 ? [`El nicho declarado: ${profile.niche.join(', ')}.`] : []),
        ],
      },
    ],
  };
}
