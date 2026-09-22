import { Inject, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { CollectionRunStatus } from '@prisma/client';
import type { Queue } from 'bullmq';
import { JsonLogger } from '../../common/json-logger.service';
import { JOB_OPTIONS, QUEUES } from '../../config/queue.config';
import { PrismaService } from '../../prisma/prisma.service';
import { IngestionService, type IngestSummary } from '../ingestion/ingestion.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  TREND_CONNECTORS_TOKEN,
  type SourceLimits,
  type TrendConnectorPort,
} from '../connectors/trend-connector.port';

export interface CollectPayload {
  sourceId: string;
  requestId: string;
}

/**
 * Cuánto se espera antes de analizar, para agrupar las fuentes de un mismo ciclo en
 * una sola llamada de IA.
 */
export const ANALYZE_COALESCE_MS = 5_000;

export interface CollectOutcome {
  status: 'OK' | 'SKIPPED';
  reason?: string;
  itemsFound?: number;
  summary?: IngestSummary;
  warnings?: string[];
}

/**
 * Recolecta UNA fuente: crea la corrida (auditoría), llama al conector, entrega
 * los items a la ingestión y cierra la corrida.
 *
 * Detalles que importan:
 *  - la corrida es idempotente por `requestId`, así que un reintento del job no
 *    duplica filas ni pierde el registro del fallo anterior;
 *  - una fuente **sin sus credenciales se saltea** (no se marca FAILED): si no,
 *    llenaría la bandeja de errores en cada ciclo y taparía los problemas reales;
 *  - si el conector lanza, la corrida queda FAILED con el motivo y el error se
 *    propaga para que BullMQ reintente con backoff.
 */
@Injectable()
export class CollectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ingestion: IngestionService,
    private readonly notifications: NotificationsService,
    private readonly logger: JsonLogger,
    @Inject(TREND_CONNECTORS_TOKEN) private readonly connectors: Map<string, TrendConnectorPort>,
    @InjectQueue(QUEUES.ANALYZE) private readonly analyzeQueue: Queue,
  ) {}

  async collect(payload: CollectPayload): Promise<CollectOutcome> {
    const source = await this.prisma.source.findUnique({ where: { id: payload.sourceId } });
    if (!source) return { status: 'SKIPPED', reason: 'La fuente ya no existe.' };
    if (!source.enabled) return { status: 'SKIPPED', reason: 'La fuente está deshabilitada.' };

    const connector = this.connectors.get(source.kind);
    if (!connector) {
      return this.fail(payload, `No hay conector registrado para el tipo ${source.kind}.`);
    }
    if (!connector.isConfigured) {
      return {
        status: 'SKIPPED',
        reason: `El conector "${connector.label}" no está configurado (revisá las llaves en el .env).`,
      };
    }

    const run = await this.prisma.collectionRun.upsert({
      where: { requestId: payload.requestId },
      update: { status: CollectionRunStatus.RUNNING, error: null },
      create: { sourceId: source.id, requestId: payload.requestId, status: CollectionRunStatus.RUNNING },
      select: { id: true },
    });

    try {
      const result = await connector.fetch({
        requestId: payload.requestId,
        sourceId: source.id,
        sourceName: source.name,
        params: source.params as Record<string, unknown>,
        limits: source.limits as SourceLimits,
      });

      const summary = await this.ingestion.ingest(source.id, result.items);

      // A los perfiles que recibieron algo nuevo se les encola el análisis: una
      // llamada de IA por perfil (no por señal), que es como está pensado el gasto.
      // Si no entró nada nuevo, no se encola nada y nadie paga.
      for (const profileId of summary.touchedProfileIds) {
        await this.analyzeQueue.add(
          'analyze',
          { profileId },
          {
            ...JOB_OPTIONS,
            /**
             * El `jobId` va por MINUTO y el job sale con un pequeño retraso: así las
             * fuentes de un mismo ciclo (que se recolectan en paralelo) se agrupan en
             * una sola llamada de IA —medido: sin esto se hacían dos— y un ciclo
             * posterior (otro minuto) sí encola un job nuevo, que es la trampa del
             * `jobId` fijo.
             */
            jobId: `analyze-${profileId}-${Math.floor(Date.now() / 60_000)}`,
            delay: ANALYZE_COALESCE_MS,
          },
        );
      }

      await this.prisma.collectionRun.update({
        where: { id: run.id },
        data: {
          status: CollectionRunStatus.OK,
          finishedAt: new Date(),
          itemsFound: result.items.length,
          itemsNew: summary.created,
          // Los avisos se guardan en la corrida: es donde uno mira cuando una
          // fuente "anduvo pero no trajo nada".
          error: result.warnings.length > 0 ? result.warnings.join(' | ') : null,
        },
      });
      await this.touchSource(source.id, result.items.length);

      return {
        status: 'OK',
        itemsFound: result.items.length,
        summary,
        warnings: result.warnings,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.collectionRun.update({
        where: { id: run.id },
        data: { status: CollectionRunStatus.FAILED, finishedAt: new Date(), error: message },
      });
      await this.touchSource(source.id, 0);

      this.logger.error(
        { msg: 'La recolección falló', source: source.name, kind: source.kind, error: message },
        'Collection',
      );

      // El aviso va por perfil (aparece bajo el perfil que la usa), y no tumba la
      // corrida: `notify` es fail-soft.
      const subscribers = await this.prisma.profileSource.findMany({
        where: { sourceId: source.id, enabled: true },
        select: { profileId: true },
      });
      for (const subscriber of subscribers) {
        await this.notifications.notify({
          type: 'COLLECTION_FAILED',
          profileId: subscriber.profileId,
          title: `Falló la recolección de "${source.name}"`,
          body: `${message} Las demás fuentes siguen funcionando.`,
          payload: { sourceId: source.id, kind: source.kind },
        });
      }

      throw error;
    }
  }

  private async fail(payload: CollectPayload, reason: string): Promise<CollectOutcome> {
    await this.prisma.collectionRun.upsert({
      where: { requestId: payload.requestId },
      update: { status: CollectionRunStatus.FAILED, error: reason, finishedAt: new Date() },
      create: {
        sourceId: payload.sourceId,
        requestId: payload.requestId,
        status: CollectionRunStatus.FAILED,
        error: reason,
        finishedAt: new Date(),
      },
    });
    return { status: 'SKIPPED', reason };
  }

  private async touchSource(sourceId: string, found: number): Promise<void> {
    const source = await this.prisma.source.findUnique({
      where: { id: sourceId },
      select: { intervalHours: true },
    });
    // La cadencia real la decide el perfil (ver `DispatchService`); acá solo se
    // deja la marca de la última corrida para la UI.
    await this.prisma.source.update({
      where: { id: sourceId },
      data: {
        lastRunAt: new Date(),
        nextRunAt: new Date(Date.now() + (source?.intervalHours ?? 24) * 60 * 60 * 1000),
      },
    });

    if (found === 0) {
      this.logger.warn({ msg: 'La fuente no trajo items', sourceId }, 'Collection');
    }
  }
}
