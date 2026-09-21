import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, SignalKind } from '@prisma/client';
import { buildDupKey } from '../../common/dup-key';
import { fingerprintOf } from '../../common/hash.util';
import { canonicalizeUrl } from '../../common/url.util';
import { PrismaService } from '../../prisma/prisma.service';
import {
  EMBEDDING_PROVIDER_TOKEN,
  type EmbeddingProviderPort,
} from '../embeddings/embedding-provider.port';
import { SignalDraftSchema, type SignalDraft } from '../connectors/signal-draft.schema';

/**
 * Ingestión: convierte lo que trajo un conector en filas de `Signal`, sin
 * duplicar y repartiendo a los perfiles suscritos.
 *
 * Es el único punto de entrada de señales (lo usan la recolección automática y el
 * pegado manual), así que acá vive la idempotencia:
 *
 *  1. **fingerprint** = sha256 de la URL canónica (o del texto, si no hay URL).
 *     Si ya existe, no se crea nada: reingestar el mismo enlace con otros
 *     parámetros no duplica. Esto es lo que hace seguro reintentar una corrida.
 *  2. **dupKey** (título + autor): si la misma pieza aparece con otra URL, la fila
 *     se crea **marcada** como duplicada (nunca se borra y la UI la oculta por
 *     defecto, con un botón para desmarcarla).
 *  3. **fan-out N:M**: por cada perfil que tiene seleccionada esa fuente se crea
 *     su `ProfileSignal`, así el análisis de la fase 3 trabaja por perfil.
 *
 * El embedding es *best-effort*: si el proveedor falla, la señal entra igual (el
 * vector es para similitud, no para dedup) y el fallo se reporta en el resumen.
 */

export interface IngestSummary {
  /** Items válidos y nuevos. */
  created: number;
  /** Ya los teníamos (mismo fingerprint). */
  alreadyKnown: number;
  /** Marcados como duplicados de otro (misma pieza, otra URL). */
  markedAsDuplicate: number;
  /** Descartados: no cumplen el contrato o no tienen URL resoluble. */
  invalid: number;
  /** Perfiles a los que se repartieron las señales nuevas. */
  profileSignals: number;
  embeddingFailures: number;
  firstEmbeddingError: string | null;
}

@Injectable()
export class IngestionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMBEDDING_PROVIDER_TOKEN) private readonly embeddings: EmbeddingProviderPort,
  ) {}

  async ingest(sourceId: string, drafts: SignalDraft[]): Promise<IngestSummary> {
    const summary: IngestSummary = {
      created: 0,
      alreadyKnown: 0,
      markedAsDuplicate: 0,
      invalid: 0,
      profileSignals: 0,
      embeddingFailures: 0,
      firstEmbeddingError: null,
    };

    if (drafts.length === 0) return summary;

    // A qué perfiles hay que repartirles lo que entre (se resuelve una vez).
    const subscribers = await this.profilesForSource(sourceId);
    const seenInThisBatch = new Set<string>();

    for (const draft of drafts) {
      const parsed = SignalDraftSchema.safeParse(draft);
      if (!parsed.success) {
        summary.invalid += 1;
        continue;
      }

      const canonicalUrl = canonicalizeUrl(parsed.data.url);
      if (!canonicalUrl) {
        summary.invalid += 1;
        continue;
      }

      const fingerprint = fingerprintOf(canonicalUrl);
      // Repetido dentro del mismo lote (dos fuentes que traen lo mismo a la vez)
      // o ya guardado de antes.
      if (seenInThisBatch.has(fingerprint)) {
        summary.alreadyKnown += 1;
        continue;
      }
      seenInThisBatch.add(fingerprint);

      const existing = await this.prisma.signal.findUnique({
        where: { fingerprint },
        select: { id: true },
      });
      if (existing) {
        summary.alreadyKnown += 1;
        continue;
      }

      const dupKey = buildDupKey(parsed.data.title, parsed.data.author);
      const original = dupKey
        ? await this.prisma.signal.findFirst({
            where: { dupKey, duplicateOfId: null },
            select: { id: true },
            orderBy: { createdAt: 'asc' },
          })
        : null;

      const signal = await this.prisma.signal.create({
        data: {
          sourceId,
          kind: parsed.data.kind as SignalKind,
          fingerprint,
          canonicalUrl,
          // La URL original se guarda tal cual (es la que se abre); la canónica
          // queda aparte, que es la clave de dedup.
          url: parsed.data.url,
          title: parsed.data.title,
          summary: parsed.data.summary ?? null,
          author: parsed.data.author ?? null,
          platform: parsed.data.platform ?? null,
          publishedAt: parsed.data.publishedAt ?? null,
          region: parsed.data.region ?? null,
          keywords: parsed.data.keywords,
          metrics: parsed.data.metrics as Prisma.InputJsonValue,
          raw: parsed.data.raw as Prisma.InputJsonValue,
          dupKey,
          duplicateOfId: original?.id ?? null,
          status: 'RAW',
        },
        select: { id: true },
      });

      if (original) summary.markedAsDuplicate += 1;
      summary.created += 1;

      const embedding = await this.writeEmbedding(signal.id, embeddingText(parsed.data));
      if (embedding.error) {
        summary.embeddingFailures += 1;
        summary.firstEmbeddingError ??= embedding.error;
      }

      // Un duplicado NO se reparte: el perfil ya tiene la pieza original, y
      // analizarla dos veces costaría IA por nada.
      if (subscribers.length > 0 && !original) {
        await this.prisma.profileSignal.createMany({
          data: subscribers.map((profileId) => ({ signalId: signal.id, profileId })),
          skipDuplicates: true,
        });
        summary.profileSignals += subscribers.length;
      }
    }

    return summary;
  }

  /** Perfiles que seleccionaron esa fuente y la tienen habilitada. */
  private async profilesForSource(sourceId: string): Promise<string[]> {
    const selections = await this.prisma.profileSource.findMany({
      where: { sourceId, enabled: true },
      select: { profileId: true },
    });
    return selections.map((selection) => selection.profileId);
  }

  /**
   * Escribe el vector con SQL crudo: `Signal.embedding` es una columna
   * `Unsupported` para Prisma (`vector(1536)`), así que no se puede setear con el
   * cliente tipado.
   */
  private async writeEmbedding(
    signalId: string,
    text: string,
  ): Promise<{ error: string | null }> {
    try {
      const [vector] = await this.embeddings.embed([text.slice(0, 2000)]);
      if (!vector || vector.length === 0) return { error: null };

      await this.prisma.$executeRaw`
        UPDATE "Signal" SET embedding = ${toVectorLiteral(vector)}::vector WHERE id = ${signalId}
      `;
      return { error: null };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }
}

/** `[0.1,0.2]` — el formato que entiende pgvector. */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.map((value) => (Number.isFinite(value) ? value : 0)).join(',')}]`;
}

function embeddingText(draft: SignalDraft): string {
  return [draft.title, draft.summary ?? '', draft.keywords.join(' ')].filter(Boolean).join('\n');
}
