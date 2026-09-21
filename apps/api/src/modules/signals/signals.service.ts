import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma, SignalKind } from '@prisma/client';
import { buildDupKey } from '../../common/dup-key';
import { fingerprintOf, fingerprintOfText } from '../../common/hash.util';
import { canonicalizeUrl } from '../../common/url.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessScope } from '../auth/access-scope.service';
import type { AuthPayload } from '../auth/auth.types';
import type { ManualSignalInput, SignalListQuery } from './signals.schema';

/**
 * Lectura de señales + el pegado manual.
 *
 * Qué ve cada usuario: las señales que le tocaron a SUS perfiles (vía
 * `ProfileSignal`), que es el reparto que hizo la ingestión. El catálogo de
 * fuentes es compartido, pero lo que se muestra es lo que el análisis le asignó a
 * un perfil alcanzable.
 */
@Injectable()
export class SignalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessScope,
  ) {}

  async list(user: AuthPayload, query: SignalListQuery) {
    if (query.profileId) {
      await this.access.assertProfile(user, query.profileId);
    }

    const where: Prisma.SignalWhereInput = {};
    const profileFilter: Prisma.ProfileWhereInput = query.profileId
      ? { id: query.profileId }
      : this.access.profileWhere(user);

    // Solo lo que le tocó a algún perfil alcanzable.
    where.profileSignals = {
      some: {
        profile: profileFilter,
        ...(query.minRelevance === undefined ? {} : { relevanceScore: { gte: query.minRelevance } }),
      },
    };

    if (query.platform) where.platform = query.platform;
    if (query.kind) where.kind = query.kind;
    if (query.days) {
      const since = new Date(Date.now() - query.days * 24 * 60 * 60 * 1000);
      where.createdAt = { gte: since };
    }
    if (query.q) {
      where.OR = [
        { title: { contains: query.q, mode: 'insensitive' } },
        { summary: { contains: query.q, mode: 'insensitive' } },
        { author: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    if (query.duplicates === 'hide') where.duplicateOfId = null;
    if (query.duplicates === 'show') where.duplicateOfId = { not: null };

    const [total, signals] = await Promise.all([
      this.prisma.signal.count({ where }),
      this.prisma.signal.findMany({
        where,
        orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
        take: query.limit,
        skip: query.offset,
        include: {
          source: { select: { id: true, name: true, kind: true } },
          profileSignals: {
            where: { profile: profileFilter },
            select: { profileId: true, relevanceScore: true, status: true, reasons: true },
          },
        },
      }),
    ]);

    return { total, count: signals.length, signals: signals.map(toSignalView) };
  }

  async get(user: AuthPayload, signalId: string) {
    const signal = await this.prisma.signal.findFirst({
      where: {
        id: signalId,
        profileSignals: { some: { profile: this.access.profileWhere(user) } },
      },
      include: {
        source: { select: { id: true, name: true, kind: true } },
        profileSignals: {
          where: { profile: this.access.profileWhere(user) },
          select: { profileId: true, relevanceScore: true, status: true, reasons: true },
        },
        duplicateOf: { select: { id: true, title: true, url: true } },
      },
    });

    if (!signal) throw new BadRequestException(`La señal ${signalId} no existe o no es alcanzable.`);
    return { ...toSignalView(signal), duplicateOf: signal.duplicateOf };
  }

  /**
   * Pegar una inspiración y que entre al MISMO pipeline.
   *
   * No pasa por `IngestionService` a propósito: ese camino valida el contrato de
   * conectores, donde la URL es obligatoria porque sin URL no hay dedup. Acá el
   * dedup se hace por texto cuando no hay enlace, y la señal se asigna **a un
   * perfil concreto** (no al fan-out de una fuente).
   */
  async createManual(user: AuthPayload, input: ManualSignalInput) {
    await this.access.assertProfile(user, input.profileId);

    const canonicalUrl = input.url ? canonicalizeUrl(input.url) : null;
    if (input.url && !canonicalUrl) {
      throw new BadRequestException('La URL no se pudo normalizar.');
    }

    const fingerprint = canonicalUrl ? fingerprintOf(canonicalUrl) : fingerprintOfText(input.text);
    const source = await this.ensureManualSource();

    const existing = await this.prisma.signal.findUnique({ where: { fingerprint }, select: { id: true } });
    if (existing) {
      // Ya estaba (lo pegaste antes): no se duplica, pero se re-asegura que el
      // perfil lo tenga asignado.
      await this.assignToProfile(existing.id, input.profileId);
      return { created: false, signalId: existing.id };
    }

    const title = input.title ?? deriveTitle(input.text, input.url ?? null);
    const signal = await this.prisma.signal.create({
      data: {
        sourceId: source.id,
        kind: input.kind as SignalKind,
        fingerprint,
        canonicalUrl,
        url: input.url ?? null,
        title,
        // El texto pegado ES el contenido: entra como resumen (que es lo que come
        // el embedding y el prompt). El texto completo queda en `raw`.
        summary: input.text.slice(0, 2000),
        author: input.author ?? null,
        platform: input.platform ?? null,
        publishedAt: new Date(),
        keywords: [],
        metrics: {},
        raw: { manual: true, text: input.text, note: input.note ?? null } as Prisma.InputJsonValue,
        // Mismo criterio que la ingestión: la misma pieza en otra URL se marca.
        dupKey: buildDupKey(title, input.author),
        status: 'RAW',
      },
      select: { id: true },
    });

    await this.assignToProfile(signal.id, input.profileId);
    return { created: true, signalId: signal.id };
  }

  private async assignToProfile(signalId: string, profileId: string): Promise<void> {
    await this.prisma.profileSignal.upsert({
      where: { signalId_profileId: { signalId, profileId } },
      update: {},
      create: { signalId, profileId },
    });
  }

  /**
   * Fuente sintética para lo que se pega a mano: `Signal.sourceId` es obligatorio,
   * así que todo lo manual cuelga de una única fuente `MANUAL` deshabilitada (el
   * scheduler solo despacha fuentes habilitadas, así que nunca se intenta
   * recolectar).
   */
  private async ensureManualSource(): Promise<{ id: string }> {
    const existing = await this.prisma.source.findFirst({
      where: { kind: 'MANUAL' },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) return existing;

    return this.prisma.source.create({
      data: {
        name: 'Inspiración (pegado a mano)',
        kind: 'MANUAL',
        params: {} as Prisma.InputJsonValue,
        limits: {} as Prisma.InputJsonValue,
        // Deshabilitada: el despacho solo mira fuentes habilitadas, así que nunca
        // se intenta recolectar. (`Source.nextRunAt` no es nulo, así que se deja
        // el default; el flag es el que manda.)
        enabled: false,
        intervalHours: 24,
      },
      select: { id: true },
    });
  }
}

interface SignalRow {
  id: string;
  kind: SignalKind;
  title: string;
  url: string | null;
  summary: string | null;
  author: string | null;
  platform: string | null;
  publishedAt: Date | null;
  region: string | null;
  keywords: string[];
  metrics: Prisma.JsonValue;
  status: string;
  duplicateOfId: string | null;
  createdAt: Date;
  source?: { id: string; name: string; kind: string } | null;
  profileSignals?: Array<{
    profileId: string;
    relevanceScore: number;
    status: string;
    reasons: Prisma.JsonValue;
  }>;
}

/** Vista de API: no se filtra la fila cruda de Prisma al cliente. */
function toSignalView(signal: SignalRow) {
  return {
    id: signal.id,
    kind: signal.kind,
    title: signal.title,
    url: signal.url,
    summary: signal.summary,
    author: signal.author,
    platform: signal.platform,
    publishedAt: signal.publishedAt,
    region: signal.region,
    keywords: signal.keywords,
    metrics: signal.metrics,
    status: signal.status,
    isDuplicate: signal.duplicateOfId !== null,
    duplicateOfId: signal.duplicateOfId,
    createdAt: signal.createdAt,
    source: signal.source ?? null,
    /** Relevancia por perfil (0 si todavía no se analizó: eso es la fase 3). */
    relevance: (signal.profileSignals ?? []).map((row) => ({
      profileId: row.profileId,
      score: row.relevanceScore,
      status: row.status,
      reasons: row.reasons,
    })),
  };
}

/** Título para lo pegado sin título: la primera línea del texto, recortada. */
function deriveTitle(text: string, url: string | null): string {
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (firstLine) return firstLine.slice(0, 160);

  if (url) {
    try {
      const parsed = new URL(url);
      return `${parsed.hostname}${parsed.pathname}`.slice(0, 160);
    } catch {
      return url.slice(0, 160);
    }
  }

  return 'Inspiración';
}
