import { Injectable, NotFoundException } from '@nestjs/common';
import { MetricSource, type Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessScope } from '../auth/access-scope.service';
import type { AuthPayload } from '../auth/auth.types';
import { normalizeToDay, parseMetricsCsv } from './metrics.csv';
import type { MetricListQuery, MetricRow, MetricSnapshotInput } from './metrics.schema';

/**
 * Métricas de las cuentas (hoy, cargadas a mano).
 *
 * Es la entrada del reporte de rendimiento: sin esto el coach sugiere igual, pero no
 * puede decir qué funcionó. La regla que importa es la idempotencia: el snapshot es
 * por **cuenta y día**, así que reimportar el mismo CSV actualiza en vez de duplicar
 * (y el reporte no cuenta dos veces el mismo día).
 */
@Injectable()
export class MetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessScope,
  ) {}

  async import(
    user: AuthPayload,
    accountId: string,
    input: MetricSnapshotInput,
  ): Promise<{ imported: number; warnings: string[] }> {
    const account = await this.assertAccount(user, accountId);

    const csv = input.csv?.trim();
    const parsed = csv
      ? parseMetricsCsv(csv)
      : {
          rows: [singleRow(input)],
          warnings: [] as string[],
        };

    for (const row of parsed.rows) {
      const data = { ...row, source: MetricSource.MANUAL };
      await this.prisma.metricSnapshot.upsert({
        where: { socialAccountId_capturedAt: { socialAccountId: accountId, capturedAt: row.capturedAt } },
        // El mismo día se REEMPLAZA: es la misma medición corregida, no otra.
        update: { ...data, raw: rawFor(csv) },
        create: {
          ...data,
          socialAccountId: accountId,
          profileId: account.profileId,
          raw: rawFor(csv),
        },
      });
    }

    return { imported: parsed.rows.length, warnings: parsed.warnings };
  }

  async list(user: AuthPayload, accountId: string, query: MetricListQuery) {
    await this.assertAccount(user, accountId);

    const since = new Date(Date.now() - query.days * 24 * 60 * 60 * 1000);
    return this.prisma.metricSnapshot.findMany({
      where: { socialAccountId: accountId, capturedAt: { gte: since } },
      orderBy: { capturedAt: 'asc' },
    });
  }

  /** La cuenta tiene que ser de un perfil alcanzable (404 si no). */
  private async assertAccount(user: AuthPayload, accountId: string) {
    const account = await this.prisma.socialAccount.findFirst({
      where: { id: accountId, profile: this.access.profileWhere(user) },
      select: { id: true, profileId: true, platform: true, handle: true },
    });
    if (!account) throw new NotFoundException(`La cuenta ${accountId} no existe.`);
    return account;
  }
}

function singleRow(input: MetricSnapshotInput): MetricRow {
  return {
    capturedAt: normalizeToDay(input.capturedAt ?? new Date()),
    ...(input.followers === null || input.followers === undefined ? {} : { followers: input.followers }),
    ...(input.reach === null || input.reach === undefined ? {} : { reach: input.reach }),
    ...(input.impressions === null || input.impressions === undefined ? {} : { impressions: input.impressions }),
    ...(input.engagementRate === null || input.engagementRate === undefined
      ? {}
      : { engagementRate: input.engagementRate }),
    ...(input.likes === null || input.likes === undefined ? {} : { likes: input.likes }),
    ...(input.comments === null || input.comments === undefined ? {} : { comments: input.comments }),
    ...(input.shares === null || input.shares === undefined ? {} : { shares: input.shares }),
    ...(input.saves === null || input.saves === undefined ? {} : { saves: input.saves }),
  };
}

/**
 * En `raw` queda el origen: para un CSV alcanza con marcarlo (guardar 200 KB en cada
 * fila sería un desperdicio); para un snapshot suelto se guarda tal cual.
 */
function rawFor(csv: string | null | undefined): Prisma.InputJsonValue {
  return csv ? { manual: true, fromCsv: true } : { manual: true };
}
