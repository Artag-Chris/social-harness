import type { SignalKind } from '@prisma/client';
import { absolutizeUrl } from '../../common/url.util';
import type { PlatformKey } from '../platforms/platforms.catalog';
import type { SignalDraft } from './signal-draft.schema';
import type { ScrapedItem } from './engine/scraped-item';
import type { SourceLimits } from './trend-connector.port';
import type { FetchPageOptions } from './engine/fetch-page';

/**
 * Puente entre lo que lee el motor (`ScrapedItem`, permisivo) y el contrato que
 * consume el pipeline (`SignalDraft`, estricto).
 *
 * Es el único lugar donde se decide que un item NO sirve: sin URL no hay dedup, y
 * sin dedup la misma señal entraría en cada ciclo.
 */

export interface DraftContext {
  kind: SignalKind;
  platform?: PlatformKey | null;
  region?: string | null;
  keywords?: string[];
  /** Base para resolver URLs relativas (la URL del feed o de la página). */
  baseUrl: string;
}

export function toSignalDraft(item: ScrapedItem, context: DraftContext): SignalDraft | null {
  const url = absolutizeUrl(item.url, context.baseUrl);
  if (!url) return null;

  return {
    kind: context.kind,
    url,
    title: resolveTitle(item.title, url),
    author: item.author ?? null,
    platform: context.platform ?? null,
    publishedAt: parseDate(item.publishedAt),
    region: context.region ?? null,
    keywords: item.keywords && item.keywords.length > 0 ? item.keywords : (context.keywords ?? []),
    metrics: item.metrics ?? {},
    summary: item.summary ?? null,
    raw: { scraped: item },
  };
}

/** Traduce los límites de la fuente a opciones de red. */
export function fetchOptionsFrom(limits?: SourceLimits): FetchPageOptions {
  return {
    timeoutMs: limits?.timeoutMs,
    userAgent: limits?.userAgent,
    headers: limits?.headers,
  };
}

/**
 * Título usable: si el motor no encontró uno, se usa la parte final de la URL.
 * Un signal sin título no se puede analizar, y descartarlo sería perder la señal
 * por un problema de selectores.
 */
export function resolveTitle(rawTitle: string, url: string): string {
  const title = rawTitle.trim();
  if (title.length > 0 && title !== '(sin título)') return title;

  try {
    const parsed = new URL(url);
    const lastSegment = parsed.pathname.split('/').filter(Boolean).pop();
    return decodeURIComponent(lastSegment ?? parsed.hostname).replace(/[-_]+/g, ' ').trim() || parsed.hostname;
  } catch {
    return url;
  }
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
