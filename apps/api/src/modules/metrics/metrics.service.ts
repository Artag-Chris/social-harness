import { Injectable, NotFoundException } from '@nestjs/common';
import { IdeaStatus, MetricSource, type Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessScope } from '../auth/access-scope.service';
import type { AuthPayload } from '../auth/auth.types';
import { buildGrowth, type Growth } from './growth';
import { normalizeToDay, parseMetricsCsv } from './metrics.csv';
import type { GrowthQuery, MetricListQuery, MetricRow, MetricSnapshotInput } from './metrics.schema';

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

  /**
   * Crecimiento del perfil y gap de objetivos.
   *
   * No usa IA y no cuesta nada: es aritmética sobre el histórico (ver `growth.ts`). Por eso
   * el dashboard puede pedirlo todas las veces que quiera.
   */
  async growth(user: AuthPayload, profileId: string, query: GrowthQuery): Promise<Growth> {
    await this.access.assertProfile(user, profileId);

    const profile = await this.prisma.profile.findUnique({
      where: { id: profileId },
      select: { id: true, accounts: true, objectives: true },
    });

    // `assertProfile` ya garantiza que existe y que el usuario puede verlo.
    if (!profile) throw new NotFoundException(`El perfil ${profileId} no existe.`);

    const since = new Date(Date.now() - query.days * 24 * 60 * 60 * 1000);

    const [snapshots, published] = await Promise.all([
      this.prisma.metricSnapshot.findMany({
        where: { profileId, capturedAt: { gte: since } },
        orderBy: { capturedAt: 'asc' },
      }),
      this.prisma.contentIdea.count({
        where: { profileId, status: IdeaStatus.PUBLISHED, publishedAt: { gte: since } },
      }),
    ]);

    return buildGrowth({
      accounts: profile.accounts,
      objectives: profile.objectives,
      snapshots,
      // POSTS_PER_WEEK no sale de las métricas: sale de las publicaciones marcadas.
      measuredByCode: {
        POSTS_PER_WEEK: Math.round((published / (query.days / 7)) * 100) / 100,
      },
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
