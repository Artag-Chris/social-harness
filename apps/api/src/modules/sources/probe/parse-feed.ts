import Parser from 'rss-parser';
import type { ProbeItem } from '../sources.schema';

/**
 * Lectura de un feed RSS/Atom.
 *
 * Se usa `rss-parser` y no una expresión regular: los feeds reales traen CDATA,
 * namespaces, Atom con `<entry>` en vez de `<item>`... parsearlos a mano es
 * frágil justo donde no se puede fallar (una fuente que deja de traer señales sin
 * avisar).
 */
const parser = new Parser({
  customFields: {
    item: [
      ['media:content', 'mediaContent'],
      ['media:thumbnail', 'mediaThumbnail'],
      ['content:encoded', 'contentEncoded'],
    ],
  },
});

export interface ParsedFeed {
  title: string;
  items: ProbeItem[];
  /** Items que vinieron sin fecha: sirven igual, pero conviene saberlo. */
  itemsWithoutDate: number;
  warnings: string[];
}

export async function parseFeed(body: string): Promise<ParsedFeed> {
  let feed: Awaited<ReturnType<typeof parser.parseString>>;
  try {
    feed = await parser.parseString(body);
  } catch (error) {
    throw new Error(
      `El contenido no parece un feed RSS/Atom válido: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const warnings: string[] = [];

  const parsed = (feed.items ?? []).map((raw) => {
    const item = raw as unknown as Record<string, unknown>;
    const publishedAt = toIsoDate(item.isoDate) ?? toIsoDate(item.pubDate);
    const url = firstString(item.link, item.guid, item.id) ?? '';

    return {
      publishedAt,
      item: {
        title: firstString(item.title) ?? '(sin título)',
        url,
        author: firstString(item.creator, item.author, item['dc:creator']),
        publishedAt,
        summary: firstString(item.contentSnippet, item.summary, item.contentEncoded)?.slice(0, 400) ?? null,
        metrics: {},
      } satisfies ProbeItem,
    };
  });

  // Se cuentan los avisos sobre los items que SE VAN A USAR: avisar de un item
  // que se descarta por otro motivo (sin enlace) sería ruido.
  const usable = parsed.filter((entry) => entry.item.url.length > 0);
  const droppedForNoLink = parsed.length - usable.length;
  const itemsWithoutDate = usable.filter((entry) => entry.publishedAt === null).length;
  const items = usable.map((entry) => entry.item);

  if (droppedForNoLink > 0) {
    warnings.push(
      `${droppedForNoLink} item(s) del feed no traían enlace y se van a descartar al recolectar.`,
    );
  }
  if (itemsWithoutDate > 0) {
    warnings.push(
      `${itemsWithoutDate} item(s) sin fecha: entran igual, pero no se pueden ordenar por antigüedad.`,
    );
  }

  return { title: firstString(feed.title) ?? '(sin título)', items, itemsWithoutDate, warnings };
}

function firstString(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate.trim();
  }
  return null;
}

function toIsoDate(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
