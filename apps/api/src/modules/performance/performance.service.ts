import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { IdeaStatus, type Prisma } from '@prisma/client';
import type { Queue } from 'bullmq';
import { JOB_OPTIONS, QUEUES } from '../../config/queue.config';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessScope } from '../auth/access-scope.service';
import type { AuthPayload } from '../auth/auth.types';
import { CommunityService } from '../community/community.service';
import { LLM_PROVIDER_TOKEN, type LlmProviderPort } from '../llm/llm-provider.port';
import {
  buildAccountGrowth,
  buildGrowth,
  formatGrowthForPrompt,
  formatGrowthForTemplate,
  type AccountGrowth,
} from '../metrics/growth';
import { NotificationsService } from '../notifications/notifications.service';
import {
  PERFORMANCE_HINT,
  PerformanceReportSchema,
  buildPerformanceSystemPrompt,
  buildPerformanceUserPrompt,
  type PerformanceReportContent,
} from './performance.prompt';

/**
 * Reporte de rendimiento.
 *
 * El diseño es defensivo en dos sentidos deliberados:
 *
 *  1. **Sin métricas cargadas no hay reporte** (y no se llama a la IA). Un análisis
 *     sin números es una opinión con formato de dato, y encima cuesta. En su lugar se
 *     avisa que faltan métricas.
 *  2. **Los deltas los calcula el código, no el modelo**: se le pasan los números ya
 *     sumados y comparados, y la IA solo interpreta. Un modelo haciendo cuentas es
 *     una fuente de errores difícil de detectar.
 *
 * Y como las métricas son por cuenta y día (no por publicación), el prompt obliga a
 * declarar la atribución gruesa en vez de inventar causas.
 */

export interface PerformanceOutcome {
  profileId: string;
  reportId: string | null;
  usedLlm: boolean;
  skipped?: string;
  measures: { accounts: number; snapshots: number; published: number };
}

@Injectable()
export class PerformanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessScope,
    private readonly notifications: NotificationsService,
    private readonly community: CommunityService,
    @Inject(LLM_PROVIDER_TOKEN) private readonly llm: LlmProviderPort,
    @InjectQueue(QUEUES.PERFORMANCE) private readonly performanceQueue: Queue,
  ) {}

  async requestRun(profileId: string, days: number): Promise<void> {
    // Pedido manual: sin `jobId`, cada clic corre (el reporte queda en el historial).
    await this.performanceQueue.add('performance', { profileId, days }, JOB_OPTIONS);
  }

  async runForProfile(profileId: string, days = 30): Promise<PerformanceOutcome> {
    const profile = await this.prisma.profile.findUnique({
      where: { id: profileId },
      include: { accounts: true, objectives: true },
    });

    const empty = { accounts: 0, snapshots: 0, published: 0 };

    if (!profile) {
      return { profileId, reportId: null, usedLlm: false, skipped: 'El perfil no existe.', measures: empty };
    }

    const since = new Date(Date.now() - days * 86_400_000);

    const snapshots = await this.prisma.metricSnapshot.findMany({
      where: { profileId, capturedAt: { gte: since } },
      orderBy: { capturedAt: 'asc' },
    });

    // Sin datos no se inventa un análisis (y no se gasta IA en uno).
    if (snapshots.length === 0) {
      await this.notifyQuietly(profileId, {
        title: `No hay métricas para analizar en ${profile.name}`,
        body: `El reporte de los últimos ${days} días necesita datos: cargá las métricas de las cuentas (a mano o pegando un CSV).`,
      });

      return {
        profileId,
        reportId: null,
        usedLlm: false,
        skipped: 'No hay métricas cargadas en el período: no se arma un reporte sin datos.',
        measures: { ...empty },
      };
    }

    const [published, topSignals] = await Promise.all([
      this.prisma.contentIdea.findMany({
        where: { profileId, status: IdeaStatus.PUBLISHED, publishedAt: { gte: since } },
        select: { title: true, platform: true, format: true, publishedAt: true },
        orderBy: { publishedAt: 'desc' },
      }),
      this.prisma.profileSignal.findMany({
        where: { profileId, scoredAt: { not: null } },
        orderBy: { relevanceScore: 'desc' },
        take: 5,
        include: { signal: { select: { title: true } } },
      }),
    ]);

    // Los números por cuenta salen del MISMO cálculo que usa el gap de objetivos
    // (`metrics/growth.ts`): una sola definición de "alcance acumulado" o de "engagement
    // promedio" en todo el harness, así el reporte no puede contradecir al dashboard.
    const deltas: AccountGrowth[] = buildAccountGrowth(profile.accounts, snapshots);

    const growth = buildGrowth({
      accounts: profile.accounts,
      objectives: profile.objectives,
      snapshots,
      // POSTS_PER_WEEK no sale de las métricas: sale de las publicaciones marcadas.
      measuredByCode: { POSTS_PER_WEEK: round(published.length / (days / 7), 2) },
    });
    const growthLines = formatGrowthForPrompt(growth);
    // A quién le habla: las recomendaciones tienen que poder decir "para quién".
    const audienceSegments = await this.community.segmentsForPrompt(profileId);

    const llmResult = await this.llm.json({
      system: buildPerformanceSystemPrompt(),
      user: buildPerformanceUserPrompt({
        profile: {
          name: profile.name,
          niche: profile.niche,
          audience: profile.audience,
          objectives: profile.objectives.map(
            (objective) => `${objective.metric} → ${objective.targetValue}`,
          ),
        },
        period: { from: since.toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10), days },
        accounts: deltas,
        published: published.map((idea) => ({
          title: idea.title,
          platform: idea.platform,
          format: idea.format,
          publishedAt: (idea.publishedAt ?? new Date()).toISOString().slice(0, 10),
        })),
        topSignals: topSignals.map((row) => ({ title: row.signal.title, score: row.relevanceScore })),
        growth: growthLines,
        audienceSegments,
      }),
      schema: PerformanceReportSchema,
      hint: PERFORMANCE_HINT,
      task: 'performance-report',
    });

    const content: PerformanceReportContent = llmResult
      ? normalizeReport(llmResult.data)
      : templateReport(deltas, published.length, formatGrowthForTemplate(growth));

    const report = await this.prisma.performanceReport.create({
      data: {
        profileId,
        periodStart: since,
        periodEnd: new Date(),
        summary: content.summary,
        whatWorked: content.whatWorked as Prisma.InputJsonValue,
        whatDidnt: content.whatDidnt as Prisma.InputJsonValue,
        adjustments: content.adjustments as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    if (llmResult) {
      await this.prisma.coachRun.create({
        data: {
          profileId,
          job: 'performance',
          model: llmResult.meta.model,
          tokensIn: llmResult.meta.usage.inputTokens,
          tokensOut: llmResult.meta.usage.outputTokens,
          costUsd: llmResult.meta.costUsd,
          latencyMs: llmResult.meta.latencyMs,
        },
      });
    }

    await this.notifyQuietly(profileId, {
      title: `Reporte de rendimiento listo para ${profile.name}`,
      body:
        `${deltas.length} cuenta(s) medidas y ${published.length} publicación(es) registradas en los últimos ${days} días. ` +
        (llmResult ? '' : 'Armado con la plantilla (no hay proveedor de IA).'),
    });

    return {
      profileId,
      reportId: report.id,
      usedLlm: llmResult !== null,
      measures: { accounts: deltas.length, snapshots: snapshots.length, published: published.length },
    };
  }

  async list(user: AuthPayload, profileId: string, limit: number) {
    await this.access.assertProfile(user, profileId);

    return this.prisma.performanceReport.findMany({
      where: { profileId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /** El aviso es un extra: no puede tumbar el reporte ya guardado. */
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

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function normalizeReport(raw: PerformanceReportContent): PerformanceReportContent {
  return {
    summary: raw.summary,
    whatWorked: raw.whatWorked ?? [],
    whatDidnt: raw.whatDidnt ?? [],
    adjustments: raw.adjustments ?? [],
  };
}

/**
 * Respaldo sin IA: el reporte se arma con los números ya calculados.
 *
 * Es corto y sin interpretación de causa (no puede saber por qué subió), pero dice lo
 * que los datos sí muestran y qué falta para poder concluir algo.
 */
function templateReport(
  deltas: AccountGrowth[],
  publishedCount: number,
  objectiveGaps: string[],
): PerformanceReportContent {
  const worked: string[] = [];
  const didnt: string[] = [];
  const adjustments: string[] = [];
  const parts: string[] = [];

  for (const delta of deltas) {
    if (delta.followers) {
      const change = delta.followers.to - delta.followers.from;
      parts.push(`${delta.platform}: ${delta.followers.from} → ${delta.followers.to} seguidores (${change >= 0 ? '+' : ''}${change})`);
      if (change > 0) worked.push(`${delta.platform} creció ${change} seguidores en el período.`);
      else if (change < 0) didnt.push(`${delta.platform} perdió ${-change} seguidores en el período.`);
    }
    if (delta.engagementRate !== undefined) {
      parts.push(`${delta.platform}: engagement promedio ${delta.engagementRate} %`);
      if (delta.engagementRate >= 3) {
        worked.push(`El engagement de ${delta.platform} (${delta.engagementRate} %) está en un rango sano.`);
      } else {
        didnt.push(`El engagement de ${delta.platform} (${delta.engagementRate} %) está bajo: revisá ganchos y formatos.`);
      }
    }
    if (delta.reach !== undefined) parts.push(`${delta.platform}: ${delta.reach} de alcance acumulado`);
  }

  if (publishedCount === 0) {
    didnt.push('No se marcó ninguna publicación como publicada: sin eso no hay forma de atribuir resultados.');
    adjustments.push('Marcá cada pieza como publicada (con su enlace) para poder comparar después.');
  }
  adjustments.push('Cargá las métricas al menos una vez por semana: los deltas de un solo día no muestran tendencia.');
  if (deltas.some((delta) => delta.followers === undefined)) {
    adjustments.push('Faltan seguidores en algunas cuentas: sin ese número no se puede medir el crecimiento.');
  }
  // El gap de objetivos es aritmética, así que se dice igual sin IA: que la plantilla lo
  // omita sería esconder justo lo que el usuario necesita saber.
  adjustments.unshift(...objectiveGaps);

  return {
    summary:
      `Reporte de plantilla (no lo escribió la IA), armado con ${deltas.length} cuenta(s) y ${publishedCount} publicación(es) registradas. ` +
      (parts.length > 0
        ? `Lo que muestran los números: ${parts.join('; ')}. `
        : 'Todavía no hay números suficientes para describir una tendencia. ') +
      'Ojo: las métricas son por cuenta y día, no por publicación, así que no se puede atribuir el resultado a una pieza concreta.',
    whatWorked: worked,
    whatDidnt: didnt,
    adjustments,
  };
}
