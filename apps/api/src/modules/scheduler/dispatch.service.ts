import { Inject, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Prisma } from '@prisma/client';
import type { Queue } from 'bullmq';
import { resolveIntervalHours } from '../../common/interval-hours';
import { JOB_OPTIONS, QUEUES } from '../../config/queue.config';
import { features } from '../../config/features';
import { PrismaService } from '../../prisma/prisma.service';
import {
  TREND_CONNECTORS_TOKEN,
  type TrendConnectorPort,
} from '../connectors/trend-connector.port';

export interface CycleSummary {
  profilesConsidered: number;
  sourcesDispatched: number;
  /** Fuentes que no se pudieron despachar, con el motivo (para que la UI lo diga). */
  skipped: Array<{ source: string; reason: string }>;
}

type ProfileWithSelections = Prisma.ProfileGetPayload<{
  include: { sources: { include: { source: true } } };
}>;

/**
 * Despacho: decide QUÉ fuentes se recolectan y las encola. No recolecta.
 *
 * La unidad de trabajo es la **fuente** (una sola descarga sirve a todos los
 * perfiles suscritos), pero el reloj es el **perfil**: el usuario configuró "este
 * perfil busca cada X horas".
 *
 * Cadencia: con varias fuentes, el perfil se despierta con la **más exigente** (si
 * una pide cada 3 h, se recolecta cada 3 h). Cada selección resuelve su cadencia
 * con la precedencia documentada en `resolveIntervalHours`
 * (selección > perfil > fuente > default del .env).
 *
 * Un perfil sin cadencia (`scheduleHours = null`) **no** se despacha solo: se corre
 * con "Buscar ahora".
 */
@Injectable()
export class DispatchService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUES.COLLECT) private readonly collectQueue: Queue,
    @Inject(TREND_CONNECTORS_TOKEN) private readonly connectors: Map<string, TrendConnectorPort>,
  ) {}

  /** Un ciclo del cron: los perfiles vencidos y listos para buscar. */
  async runCycle(): Promise<CycleSummary> {
    const due = await this.prisma.profile.findMany({
      where: {
        scheduleHours: { not: null },
        nextRunAt: { lte: new Date() },
        sources: { some: { enabled: true } },
      },
      include: { sources: { where: { enabled: true }, include: { source: true } } },
      orderBy: { nextRunAt: 'asc' },
    });

    return this.dispatchProfiles(due);
  }

  /** "Buscar ahora": ignora la cadencia y dispara las fuentes del perfil. */
  async dispatchProfile(profileId: string): Promise<CycleSummary> {
    const profile = await this.prisma.profile.findUnique({
      where: { id: profileId },
      include: { sources: { where: { enabled: true }, include: { source: true } } },
    });

    if (!profile) return { profilesConsidered: 0, sourcesDispatched: 0, skipped: [] };
    return this.dispatchProfiles([profile]);
  }

  private async dispatchProfiles(profiles: ProfileWithSelections[]): Promise<CycleSummary> {
    const cycleId = Date.now().toString(36);
    const alreadyQueued = new Set<string>();
    const skipped: CycleSummary['skipped'] = [];
    let sourcesDispatched = 0;

    for (const profile of profiles) {
      const intervals: number[] = [];

      for (const selection of profile.sources) {
        const source = selection.source;
        if (!source.enabled) continue;

        const connector = this.connectors.get(source.kind);
        if (!connector) {
          skipped.push({ source: source.name, reason: `No hay conector para el tipo ${source.kind}.` });
          continue;
        }
        if (!connector.isConfigured) {
          skipped.push({ source: source.name, reason: `${connector.label} sin credenciales en el .env.` });
          continue;
        }

        intervals.push(
          resolveIntervalHours(
            {
              selectionHours: selection.intervalHours,
              profileHours: profile.scheduleHours,
              sourceHours: source.intervalHours,
            },
            features.scheduler.sourceDefaultIntervalHours,
          ),
        );

        // La misma fuente para dos perfiles se descarga UNA vez por ciclo.
        if (alreadyQueued.has(source.id)) continue;
        alreadyQueued.add(source.id);

        await this.collectQueue.add(
          'collect',
          { sourceId: source.id, requestId: `collect-${source.id}-${cycleId}` },
          { ...JOB_OPTIONS },
        );
        sourcesDispatched += 1;
      }

      const cadenceHours =
        intervals.length > 0
          ? Math.min(...intervals)
          : features.scheduler.sourceDefaultIntervalHours;

      // Se reprograma el reloj del perfil. Si no tiene cadencia propia queda en
      // null: un perfil manual no se convierte en automático por correrlo a mano.
      await this.prisma.profile.update({
        where: { id: profile.id },
        data: {
          nextRunAt: profile.scheduleHours
            ? new Date(Date.now() + cadenceHours * 60 * 60 * 1000)
            : null,
        },
      });
    }

    return { profilesConsidered: profiles.length, sourcesDispatched, skipped };
  }
}
