import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { IdeaStatus, ProfileSignalStatus, type Prisma } from '@prisma/client';
import type { Queue } from 'bullmq';
import { features } from '../../config/features';
import { JOB_OPTIONS, QUEUES } from '../../config/queue.config';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessScope } from '../auth/access-scope.service';
import type { AuthPayload } from '../auth/auth.types';
import {
  FORMAT_KEYS,
  PLATFORM_KEYS,
  formatBelongsToPlatform,
  formatsFor,
  isFormatKey,
  isPlatformKey,
  platform,
  type PlatformKey,
} from '../platforms/platforms.catalog';
import { LLM_PROVIDER_TOKEN, type LlmProviderPort } from '../llm/llm-provider.port';
import { NotificationsService } from '../notifications/notifications.service';
import {
  IDEAS_HINT,
  IdeasResponseSchema,
  buildIdeasSystemPrompt,
  buildIdeasUserPrompt,
  suggestSchedule,
  type IdeaFromLlm,
  type IdeasResponse,
} from './ideas.prompt';
import type { IdeaInput, IdeaListQuery, IdeaPublishedInput, IdeaUpdateInput } from './ideas.schema';

/** Un elemento tal como lo devuelve el contrato (con los `default` sin aplicar). */
type ParsedIdea = IdeasResponse['ideas'][number];

/**
 * Ideas y calendario.
 *
 * Dos formas de que entren ideas:
 *  - **a demanda** (`POST /profiles/:id/ideas`): es la que se usa con el freno de
 *    costo puesto, y la única que corresponde cuando `AUTO_IDEAS_ENABLED=false`;
 *  - **automática**: el análisis la encola cuando algo pasa el umbral y el perfil
 *    tiene su `autoIdeasEnabled` encendido.
 *
 * En los dos casos: una llamada de IA por perfil (hasta `ideaPerWeek` ideas), atadas
 * a las señales que las sostienen (`IdeaSignal`) y con el formato validado contra el
 * catálogo de la red. Si no hay proveedor de IA, cae a una **plantilla
 * determinística** (marcada como `plantilla`) para que el calendario no quede vacío.
 */

export interface GenerateIdeasOutcome {
  profileId: string;
  created: number;
  usedLlm: boolean;
  rejected: number;
  skipped?: string;
}

@Injectable()
export class IdeasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessScope,
    private readonly notifications: NotificationsService,
    @Inject(LLM_PROVIDER_TOKEN) private readonly llm: LlmProviderPort,
    @InjectQueue(QUEUES.IDEAS) private readonly ideasQueue: Queue,
  ) {}

  /** Encola la generación (para el botón "Generar ideas ahora"). */
  async requestGeneration(profileId: string): Promise<void> {
    // Sin `jobId`: es un pedido manual y cada clic tiene que correr. No hay riesgo de
    // gasto repetido porque la corrida siguiente no encuentra señales sin usar.
    await this.ideasQueue.add('ideas', { profileId }, JOB_OPTIONS);
  }

  async generateForProfile(profileId: string): Promise<GenerateIdeasOutcome> {
    const profile = await this.prisma.profile.findUnique({
      where: { id: profileId },
      include: { accounts: { select: { platform: true } }, objectives: true },
    });

    if (!profile) {
      return { profileId, created: 0, usedLlm: false, rejected: 0, skipped: 'El perfil no existe.' };
    }

    const platforms = profile.accounts.map((account) => account.platform);
    const wanted = Math.max(1, profile.ideasPerWeek);

    // Señales candidatas: ya juzgadas, por encima del umbral y que no se hayan usado.
    const candidates = await this.prisma.profileSignal.findMany({
      where: {
        profileId,
        scoredAt: { not: null },
        relevanceScore: { gte: features.ideas.relevanceMinScore },
        status: { not: ProfileSignalStatus.USED },
        signal: { duplicateOfId: null },
      },
      include: { signal: true },
      orderBy: { relevanceScore: 'desc' },
      take: 12,
    });

    if (candidates.length === 0) {
      return {
        profileId,
        created: 0,
        usedLlm: false,
        rejected: 0,
        skipped: `No hay señales con relevancia ≥ ${features.ideas.relevanceMinScore} sin usar.`,
      };
    }

    // Las señales que ya sostienen una idea no se repiten (evita el ciclo infinito
    // de ideas iguales cuando se pide a mano más de una vez).
    const alreadyUsed = await this.prisma.ideaSignal.findMany({
      where: { signalId: { in: candidates.map((row) => row.signalId) } },
      select: { signalId: true },
    });
    const usedIds = new Set(alreadyUsed.map((row) => row.signalId));
    const usable = candidates.filter((row) => !usedIds.has(row.signalId));

    if (usable.length === 0) {
      return {
        profileId,
        created: 0,
        usedLlm: false,
        rejected: 0,
        skipped: 'Las señales relevantes ya están usadas por otras ideas.',
      };
    }

    const llmResult = await this.llm.json({
      system: buildIdeasSystemPrompt(),
      user: buildIdeasUserPrompt({
        profile: {
          name: profile.name,
          niche: profile.niche,
          audience: profile.audience,
          voice: profile.voice,
          language: profile.language,
          platforms,
          objectives: profile.objectives.map(
            (objective) => `${objective.metric} → ${objective.targetValue}`,
          ),
        },
        count: wanted,
        signals: usable.map((row) => ({
          id: row.signalId,
          title: row.signal.title,
          summary: row.signal.summary,
          reasons: asStringArray(row.reasons),
          score: row.relevanceScore,
          platform: row.signal.platform,
          kind: row.signal.kind,
        })),
      }),
      schema: IdeasResponseSchema,
      hint: IDEAS_HINT,
      task: 'generate-ideas',
    });

    const { ideas, rejected } = llmResult
      ? selectValidIdeas(
          llmResult.data.ideas.map(normalizeIdea),
          usable,
          platforms,
          wanted,
        )
      : { ideas: templateIdeas(usable, platforms, wanted), rejected: 0 };
    if (ideas.length === 0) {
      return {
        profileId,
        created: 0,
        usedLlm: llmResult !== null,
        rejected,
        skipped: 'La IA no devolvió ideas usables para estas señales.',
      };
    }

    if (llmResult) {
      await this.prisma.coachRun.create({
        data: {
          profileId,
          job: 'ideas',
          model: llmResult.meta.model,
          tokensIn: llmResult.meta.usage.inputTokens,
          tokensOut: llmResult.meta.usage.outputTokens,
          costUsd: llmResult.meta.costUsd,
          latencyMs: llmResult.meta.latencyMs,
        },
      });
    }

    const slots = suggestSchedule(ideas.length);
    const source = llmResult ? 'ia' : 'plantilla';

    for (const [index, idea] of ideas.entries()) {
      const created = await this.prisma.contentIdea.create({
        data: {
          profileId,
          platform: idea.platform,
          format: idea.format,
          title: idea.title,
          hook: idea.hook,
          angle: idea.angle,
          whyNow: idea.whyNow,
          hashtags: idea.hashtags,
          bestTimes: idea.bestTimes as Prisma.InputJsonValue,
          source,
          status: IdeaStatus.IDEA,
          // Sugerencia de hueco (días hábiles): el usuario lo mueve en el calendario.
          scheduledFor: slots[index] ?? null,
          signals: {
            create: idea.signalIds.map((signalId) => ({
              signalId,
              contribution: 'Señal que sostiene la idea',
            })),
          },
        },
        select: { id: true },
      });

      // La señal queda usada: no vuelve a proponerse en la próxima corrida.
      await this.prisma.profileSignal.updateMany({
        where: { profileId, signalId: { in: idea.signalIds } },
        data: { status: ProfileSignalStatus.USED },
      });

      void created;
    }

    // Igual que en el análisis: el aviso no puede tumbar las ideas ya creadas.
    try {
      await this.notifications.notify({
        type: 'IDEAS_READY',
        profileId,
        title: `${ideas.length} idea(s) nuevas para ${profile.name}`,
        body:
          source === 'ia'
            ? 'Armadas a partir de las señales más relevantes. Revisalas en el calendario.'
            : 'Se armaron con la plantilla (no hay proveedor de IA configurado). Revisalas en el calendario.',
        payload: { created: ideas.length, rejected, source },
      });
    } catch {
      // fail-soft: el aviso es un extra, no parte del resultado.
    }

    return { profileId, created: ideas.length, usedLlm: llmResult !== null, rejected };
  }

  // ── Lectura y gestión desde el dashboard ──────────────────────────────────

  async list(user: AuthPayload, query: IdeaListQuery) {
    if (query.profileId) await this.access.assertProfile(user, query.profileId);

    const where: Prisma.ContentIdeaWhereInput = {
      profile: query.profileId ? { id: query.profileId } : this.access.profileWhere(user),
    };
    if (query.status) where.status = query.status;
    if (query.platform) where.platform = query.platform;
    if (query.from || query.to) {
      where.scheduledFor = {
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to ? { lte: query.to } : {}),
      };
    }

    return this.prisma.contentIdea.findMany({
      where,
      orderBy: [{ scheduledFor: 'asc' }, { createdAt: 'desc' }],
      take: query.limit,
      include: { signals: { include: { signal: { select: { id: true, title: true, url: true, kind: true } } } } },
    });
  }

  async get(user: AuthPayload, ideaId: string) {
    const idea = await this.prisma.contentIdea.findFirst({
      where: { id: ideaId, profile: this.access.profileWhere(user) },
      include: {
        signals: { include: { signal: { select: { id: true, title: true, url: true, kind: true, summary: true } } } },
        drafts: true,
      },
    });
    if (!idea) throw new NotFoundException(`La idea ${ideaId} no existe.`);
    return idea;
  }

  async create(user: AuthPayload, input: IdeaInput) {
    await this.access.assertProfile(user, input.profileId);
    assertFormat(input.platform, input.format);

    return this.prisma.contentIdea.create({
      data: {
        profileId: input.profileId,
        platform: input.platform,
        format: input.format,
        title: input.title,
        hook: input.hook,
        angle: input.angle,
        whyNow: input.whyNow,
        hashtags: input.hashtags,
        scheduledFor: input.scheduledFor ?? null,
        // Cargada a mano: no la redactó el modelo.
        source: 'manual',
      },
    });
  }

  async update(user: AuthPayload, ideaId: string, input: IdeaUpdateInput) {
    await this.get(user, ideaId);

    return this.prisma.contentIdea.update({
      where: { id: ideaId },
      data: {
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.scheduledFor === undefined ? {} : { scheduledFor: input.scheduledFor }),
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.hook === undefined ? {} : { hook: input.hook }),
        ...(input.angle === undefined ? {} : { angle: input.angle }),
        ...(input.hashtags === undefined ? {} : { hashtags: input.hashtags }),
        ...(input.publishedUrl === undefined ? {} : { publishedUrl: input.publishedUrl }),
        // Publicar lo marca SIEMPRE el humano.
        ...(input.status === IdeaStatus.PUBLISHED ? { publishedAt: new Date() } : {}),
      },
    });
  }

  /**
   * "Ya publiqué": lo marca el humano, nunca la IA (regla del proyecto).
   *
   * El enlace es opcional pero es lo que después permite atribuir rendimiento, así
   * que se invita a pegarlo.
   */
  async markPublished(user: AuthPayload, ideaId: string, input: IdeaPublishedInput) {
    await this.get(user, ideaId);

    return this.prisma.contentIdea.update({
      where: { id: ideaId },
      data: {
        status: IdeaStatus.PUBLISHED,
        publishedAt: input.publishedAt ?? new Date(),
        ...(input.url === undefined ? {} : { publishedUrl: input.url }),
      },
    });
  }

  async remove(user: AuthPayload, ideaId: string): Promise<void> {
    await this.get(user, ideaId);
    await this.prisma.contentIdea.delete({ where: { id: ideaId } });
  }
}

/** Un formato que no existe en esa red es un error de entrada, no una idea. */
function assertFormat(platformKey: string, formatKey: string): void {
  if (!isPlatformKey(platformKey)) {
    throw new BadRequestException(`Red desconocida: "${platformKey}". Válidas: ${PLATFORM_KEYS.join(', ')}.`);
  }
  if (!isFormatKey(formatKey)) {
    throw new BadRequestException(`Formato desconocido: "${formatKey}". Válidos: ${FORMAT_KEYS.join(', ')}.`);
  }
  if (!formatBelongsToPlatform(platformKey, formatKey)) {
    throw new BadRequestException(
      `El formato "${formatKey}" no existe en ${platform(platformKey).label}. ` +
        `Válidos: ${formatsFor(platformKey).join(', ')}.`,
    );
  }
}

/**
 * Normaliza lo que devolvió el modelo: los campos con `default` en el contrato
 * (hashtags, bestTimes) pueden venir ausentes, así que se completan acá y el resto
 * del servicio trabaja con un objeto completo.
 */
function normalizeIdea(idea: ParsedIdea): IdeaFromLlm {
  return {
    ...idea,
    hashtags: idea.hashtags ?? [],
    bestTimes: idea.bestTimes ?? [],
  };
}

/**
 * Filtra lo que devolvió el modelo: red donde el perfil publica, formato válido en
 * esa red y señales que existan en el lote. Lo que no pasa se descarta (y se
 * cuenta): es preferible perder una idea a guardar una que no se puede hacer.
 */
function selectValidIdeas(
  ideas: IdeaFromLlm[],
  usable: Array<{ signalId: string }>,
  platforms: string[],
  wanted: number,
): { ideas: IdeaFromLlm[]; rejected: number } {
  const knownSignals = new Set(usable.map((row) => row.signalId));
  const selected: IdeaFromLlm[] = [];
  let rejected = 0;

  for (const idea of ideas) {
    const platformOk = platforms.length === 0 || platforms.includes(idea.platform);
    const formatOk = formatBelongsToPlatform(idea.platform, idea.format);
    const signalIds = idea.signalIds.filter((id) => knownSignals.has(id));

    if (!platformOk || !formatOk || signalIds.length === 0) {
      rejected += 1;
      continue;
    }

    selected.push({
      ...idea,
      signalIds,
      hashtags: (idea.hashtags ?? []).slice(0, 5),
      bestTimes: idea.bestTimes ?? [],
    });
    if (selected.length >= wanted) break;
  }

  return { ideas: selected, rejected };
}

/**
 * Respaldo sin IA: una idea por señal, con lo que la señal ya trae.
 *
 * No inventa horarios ni ángulos: usa el título, el resumen y las razones del
 * análisis, y el formato por defecto de la red. Queda marcada como `plantilla` para
 * que nadie la confunda con una sugerencia del modelo.
 */
function templateIdeas(
  usable: Array<{ signalId: string; signal: { title: string; summary: string | null; platform: string | null; keywords: string[] }; relevanceScore: number; reasons: unknown }>,
  platforms: string[],
  wanted: number,
): IdeaFromLlm[] {
  return usable.slice(0, wanted).map((row) => {
    // La red de la idea: por dónde llegó la señal si el perfil publica ahí; si no,
    // la primera cuenta del perfil; si no hay ninguna, Instagram por defecto.
    const candidates = [row.signal.platform, platforms[0], 'INSTAGRAM'];
    const platformKey: PlatformKey =
      candidates.find(
        (candidate): candidate is PlatformKey =>
          typeof candidate === 'string' &&
          isPlatformKey(candidate) &&
          (platforms.length === 0 || platforms.includes(candidate)),
      ) ?? 'INSTAGRAM';

    const definition = platform(platformKey);
    const format = definition.defaultFormats[0];
    const reasons = asStringArray(row.reasons);

    return {
      title: `Desde la tendencia: ${row.signal.title}`.slice(0, 200),
      hook: row.signal.summary?.slice(0, 200) ?? row.signal.title,
      angle:
        `Tomá "${row.signal.title}" y contalo con tu criterio: qué significa para ${definition.label}, ` +
        'con tu experiencia y un ejemplo concreto.',
      whyNow: `Está sonando y es relevante para tu nicho (${row.relevanceScore}/100): ${reasons[0] ?? 'toca tus temas'}.`,
      platform: platformKey,
      format,
      hashtags: row.signal.keywords.slice(0, 4),
      bestTimes: [
        {
          day: definition.bestTimesHint.split(';')[0] ?? 'días de semana',
          hour: definition.bestTimesHint.split(';')[1]?.trim() ?? 'según tu audiencia',
          reason: definition.bestTimesHint,
        },
      ],
      signalIds: [row.signalId],
    };
  });
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
