import { Inject, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { SignalStatus } from '@prisma/client';
import type { Queue } from 'bullmq';
import { features } from '../../config/features';
import { JOB_OPTIONS, QUEUES } from '../../config/queue.config';
import { PrismaService } from '../../prisma/prisma.service';
import { LLM_PROVIDER_TOKEN, type LlmProviderPort } from '../llm/llm-provider.port';
import { NotificationsService } from '../notifications/notifications.service';
import { prefilter, topMetric, type ProfileForScoring } from './relevance.prefilter';
import {
  ANALYSIS_HINT,
  AnalysisResponseSchema,
  buildAnalysisSystemPrompt,
  buildAnalysisUserPrompt,
} from './analysis.prompt';

/**
 * Análisis de relevancia por perfil.
 *
 * Cómo gasta la IA (el punto del diseño):
 *  1. **Prefilter determinístico** (gratis): puntúa y recorta a `ANALYZE_BATCH_SIZE`.
 *  2. **Una sola llamada** por perfil con todo el lote (`json()`), no una por señal.
 *  3. Si no hay proveedor (`mock`) o el modelo devuelve algo inválido, queda el
 *     score determinístico: el pipeline sigue funcionando sin llaves.
 *
 * La marca `scoredAt` es lo que evita volver a pagar por la misma señal en el ciclo
 * siguiente. Y las señales que no entraron al lote quedan sin marcar, así el próximo
 * ciclo las toma.
 */

export interface AnalysisOutcome {
  profileId: string;
  analyzed: number;
  usedLlm: boolean;
  topScore: number;
  ideasEnqueued: boolean;
  skipped?: string;
}

@Injectable()
export class AnalysisService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(LLM_PROVIDER_TOKEN) private readonly llm: LlmProviderPort,
    private readonly notifications: NotificationsService,
    @InjectQueue(QUEUES.IDEAS) private readonly ideasQueue: Queue,
  ) {}

  async analyzeProfile(profileId: string): Promise<AnalysisOutcome> {
    const profile = await this.prisma.profile.findUnique({
      where: { id: profileId },
      include: { accounts: { select: { platform: true } }, objectives: true },
    });

    if (!profile) {
      return { profileId, analyzed: 0, usedLlm: false, topScore: 0, ideasEnqueued: false, skipped: 'El perfil no existe.' };
    }

    const pending = await this.prisma.profileSignal.findMany({
      where: {
        profileId,
        scoredAt: null,
        // Los marcados como duplicados no se analizan: el perfil ya tiene el original.
        signal: { duplicateOfId: null },
      },
      include: { signal: true },
      orderBy: { createdAt: 'desc' },
      take: features.ideas.analyzeBatchSize,
    });

    if (pending.length === 0) {
      return { profileId, analyzed: 0, usedLlm: false, topScore: 0, ideasEnqueued: false, skipped: 'No hay señales nuevas que analizar.' };
    }

    const scoringProfile: ProfileForScoring = {
      niche: profile.niche,
      platforms: profile.accounts.map((account) => account.platform),
    };

    // 1) Prefilter gratis: ordena y recorta.
    const shortlist = prefilter(
      scoringProfile,
      pending.map((row) => ({
        row,
        title: row.signal.title,
        summary: row.signal.summary,
        keywords: row.signal.keywords,
        platform: row.signal.platform,
        publishedAt: row.signal.publishedAt,
        createdAt: row.signal.createdAt,
        metrics: asMetrics(row.signal.metrics),
      })),
      features.ideas.analyzeBatchSize,
    );

    // 2) Una sola llamada de IA para el lote.
    const llmResult = await this.llm.json({
      system: buildAnalysisSystemPrompt(),
      user: buildAnalysisUserPrompt({
        profile: {
          name: profile.name,
          niche: profile.niche,
          audience: profile.audience,
          voice: profile.voice,
          platforms: scoringProfile.platforms,
          objectives: profile.objectives.map((objective) => describeObjective(objective)),
        },
        signals: shortlist.map(({ signal, relevance }) => ({
          id: signal.row.signalId,
          kind: signal.row.signal.kind,
          platform: signal.row.signal.platform,
          title: signal.title,
          summary: signal.summary,
          keywords: signal.keywords,
          ageDays: ageInDays(signal.publishedAt ?? signal.createdAt),
          engagement: topMetric(signal.metrics),
        })),
      }),
      schema: AnalysisResponseSchema,
      hint: ANALYSIS_HINT,
      task: 'analyze-signals',
    });

    // El modelo puede devolver menos señales de las pedidas: las que falten se
    // quedan con el score determinístico (nunca quedan en 0 por un olvido).
    const byId = new Map(llmResult?.data.results.map((result) => [result.signalId, result]) ?? []);

    if (llmResult) {
      await this.prisma.coachRun.create({
        data: {
          profileId,
          job: 'analyze',
          model: llmResult.meta.model,
          tokensIn: llmResult.meta.usage.inputTokens,
          tokensOut: llmResult.meta.usage.outputTokens,
          costUsd: llmResult.meta.costUsd,
          latencyMs: llmResult.meta.latencyMs,
        },
      });
    }

    // 3) Persistir el juicio y marcarlo como hecho.
    let topScore = 0;
    const scoredAt = new Date();

    for (const { signal, relevance } of shortlist) {
      const judged = byId.get(signal.row.signalId);
      const score = judged ? Math.round(judged.score) : relevance.score;
      // Si el modelo no dio razones (o dio una lista vacía), quedan las del
      // prefilter: una señal con score y sin motivo no es explicable.
      const reasons =
        judged && Array.isArray(judged.reasons) && judged.reasons.length > 0
          ? judged.reasons
          : relevance.reasons;

      topScore = Math.max(topScore, score);

      await this.prisma.profileSignal.update({
        where: { id: signal.row.id },
        data: { relevanceScore: score, reasons, scoredAt },
      });
      await this.prisma.signal.update({
        where: { id: signal.row.signalId },
        data: { status: SignalStatus.ANALYZED },
      });
    }

    // 4) Si algo pasó el umbral, se encolan las ideas (según el freno de costo).
    const ideasEnabled = features.ideas.auto && profile.autoIdeasEnabled;
    let ideasEnqueued = false;

    if (ideasEnabled && topScore >= features.ideas.relevanceMinScore) {
      // Sin `jobId`: el pedido automático tiene que correr igual (la corrida
      // siguiente no encuentra señales sin usar, así que no hay gasto repetido).
      await this.ideasQueue.add('ideas', { profileId }, JOB_OPTIONS);
      ideasEnqueued = true;
    }

    // El aviso va al final y no puede tumbar el trabajo ya hecho (los scores están
    // guardados y las ideas encoladas). `notify` ya es fail-soft por canal; esto
    // cubre el caso de un canal que falle entero.
    await this.notifyQuietly({
      type: 'SIGNALS_READY',
      profileId,
      title: `${shortlist.length} señales analizadas para ${profile.name}`,
      body:
        topScore >= features.ideas.relevanceMinScore
          ? `La mejor puntuó ${topScore}. ${ideasEnqueued ? 'Se están armando ideas.' : 'Las ideas están apagadas por configuración.'}`
          : `Solo ${topScore} de puntaje: ninguna pasó el umbral de ${features.ideas.relevanceMinScore}.`,
      payload: { analyzed: shortlist.length, topScore, ideasEnqueued, usedLlm: llmResult !== null },
    });

    return {
      profileId,
      analyzed: shortlist.length,
      usedLlm: llmResult !== null,
      topScore,
      ideasEnqueued,
    };
  }

  /** Un aviso que falla no puede marcar el job como fallido: el trabajo ya está hecho. */
  private async notifyQuietly(event: Parameters<NotificationsService['notify']>[0]): Promise<void> {
    try {
      await this.notifications.notify(event);
    } catch {
      // `NotificationsService.notify` ya es fail-soft; esto es por si el propio
      // servicio falla (p. ej. la base se cayó justo ahí).
    }
  }
}

function asMetrics(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function ageInDays(date: Date): number {
  return Math.max(0, (Date.now() - date.getTime()) / 86_400_000);
}

function describeObjective(objective: {
  metric: string;
  targetValue: number;
  currentValue: number | null;
  dueDate: Date | null;
}): string {
  const progress = objective.currentValue === null ? '' : ` (hoy: ${objective.currentValue})`;
  const due = objective.dueDate ? ` para ${objective.dueDate.toISOString().slice(0, 10)}` : '';
  return `${objective.metric} → ${objective.targetValue}${progress}${due}`;
}
