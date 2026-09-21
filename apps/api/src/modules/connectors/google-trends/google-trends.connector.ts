import { SignalKind, SourceKind } from '@prisma/client';
import { fetchPage } from '../engine/fetch-page';
import { parseMetricNumber } from '../engine/parse-recipe';
import type { ConnectorResult, SignalDraft } from '../signal-draft.schema';
import type { TrendConnectorContext, TrendConnectorPort } from '../trend-connector.port';

interface TrendsParams {
  keywords: string[];
  region: string;
}

/**
 * Tendencias de búsqueda de Google (endpoint público de "daily trends").
 *
 * ⚠️ Es un endpoint **no oficial**: no hay API pública de Trends. Se usa porque es
 * la única señal de "qué está buscando la gente" disponible sin scraping de
 * páginas con JS. Si Google lo cambia o lo bloquea, la corrida queda con el motivo
 * y las demás fuentes siguen.
 *
 * Se emite UNA señal por tendencia (no por artículo): la URL es la página de
 * Trends de esa búsqueda, que es estable y única — así el dedup funciona entre
 * corridas sin inventar identificadores.
 */
export class GoogleTrendsConnector implements TrendConnectorPort {
  readonly kind = SourceKind.GOOGLE_TRENDS;
  readonly label = 'Google Trends (endpoint público)';
  readonly isConfigured = true;

  constructor(private readonly defaultRegion: string) {}

  async fetch(ctx: TrendConnectorContext, signal?: AbortSignal): Promise<ConnectorResult> {
    const params = readParams(ctx.params, this.defaultRegion);
    const url = new URL('https://trends.google.com/trends/api/dailytrends');
    url.searchParams.set('hl', 'es-419');
    url.searchParams.set('tz', '-300');
    url.searchParams.set('geo', params.region);
    url.searchParams.set('ns', '15');

    const page = await fetchPage(url.toString(), { timeoutMs: ctx.limits?.timeoutMs, signal });
    if (page.status >= 400) {
      throw new Error(`Google Trends respondió HTTP ${page.status}.`);
    }

    const trends = readTrends(page.body);
    if (trends.length === 0) {
      return {
        items: [],
        diagnostics: [],
        warnings: [
          'Google Trends respondió pero sin tendencias. Puede ser el formato de la respuesta (endpoint no oficial) o que no haya datos para esa región.',
        ],
      };
    }

    const matched = params.keywords.length > 0 ? trends.filter((trend) => matches(trend, params.keywords)) : trends;
    const items = matched.slice(0, 25).map((trend) => toDraft(trend, params.region));

    const warnings: string[] = [];
    if (params.keywords.length > 0 && items.length === 0) {
      warnings.push(
        `Ninguna de las ${trends.length} tendencias de ${params.region} toca tus temas (${params.keywords.join(', ')}). ` +
          'Suele pasar en nichos específicos: conviene sumar YouTube o un feed del sector.',
      );
    }

    return { items, warnings, diagnostics: [] };
  }
}

interface Trend {
  query: string;
  traffic?: number;
  related: string[];
  articles: string[];
}

function toDraft(trend: Trend, region: string): SignalDraft {
  const exploreUrl = `https://trends.google.com/trends/explore?geo=${region}&q=${encodeURIComponent(trend.query)}`;
  const summary = [
    trend.related.length > 0 ? `Consultas relacionadas: ${trend.related.join(', ')}.` : null,
    trend.articles.length > 0 ? `Se está cubriendo: ${trend.articles.join(' | ')}.` : null,
  ]
    .filter(Boolean)
    .join(' ');

  return {
    kind: SignalKind.TREND,
    url: exploreUrl,
    title: trend.query,
    author: null,
    platform: null,
    publishedAt: new Date(),
    region,
    keywords: [trend.query, ...trend.related].slice(0, 10),
    metrics: trend.traffic === undefined ? {} : { approxTraffic: trend.traffic },
    summary: summary.length > 0 ? summary : null,
    raw: { trend },
  };
}

/** El endpoint responde con `)]}',` delante del JSON (protección anti-JSON-hijacking). */
export function readTrends(body: string): Trend[] {
  const start = body.indexOf('{');
  if (start < 0) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.slice(start));
  } catch {
    return [];
  }

  const days = (parsed as { default?: { trendingSearchesDays?: unknown[] } }).default?.trendingSearchesDays;
  if (!Array.isArray(days)) return [];

  const trends: Trend[] = [];
  for (const day of days) {
    const searches = (day as { trendingSearches?: unknown[] }).trendingSearches;
    if (!Array.isArray(searches)) continue;

    for (const search of searches) {
      const entry = search as {
        title?: { query?: string };
        formattedTraffic?: string;
        relatedQueries?: Array<{ query?: string }>;
        articles?: Array<{ title?: string; source?: string }>;
      };
      const query = entry.title?.query;
      if (typeof query !== 'string' || query.length === 0) continue;

      trends.push({
        query,
        traffic: entry.formattedTraffic ? parseMetricNumber(entry.formattedTraffic) : undefined,
        related: (entry.relatedQueries ?? [])
          .map((related) => related.query)
          .filter((value): value is string => typeof value === 'string' && value.length > 0)
          .slice(0, 6),
        articles: (entry.articles ?? [])
          .map((article) => article.title)
          .filter((value): value is string => typeof value === 'string' && value.length > 0)
          .slice(0, 3),
      });
    }
  }

  return trends;
}

/** ¿La tendencia toca alguno de los temas? Compara sin acentos ni mayúsculas. */
function matches(trend: Trend, keywords: string[]): boolean {
  const haystack = [trend.query, ...trend.related, ...trend.articles].join(' ').toLowerCase();
  return keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
}

function readParams(params: Record<string, unknown>, defaultRegion: string): TrendsParams {
  return {
    keywords: Array.isArray(params.keywords)
      ? params.keywords.filter((value): value is string => typeof value === 'string' && value.length > 0)
      : [],
    region:
      typeof params.region === 'string' && params.region.length === 2 ? params.region : defaultRegion,
  };
}
