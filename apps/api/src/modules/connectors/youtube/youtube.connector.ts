import { SignalKind, SourceKind } from '@prisma/client';
import type { ConnectorResult, SignalDraft } from '../signal-draft.schema';
import type { TrendConnectorContext, TrendConnectorPort } from '../trend-connector.port';

interface YoutubeParams {
  keywords: string[];
  region: string;
  maxItems: number;
}

const API_BASE = 'https://www.googleapis.com/youtube/v3';
const SEARCH_WINDOW_DAYS = 30;
const DEFAULT_DELAY_MS = 250;

/**
 * Conector de YouTube Data API v3 — la fuente más rica y automatizable
 * (búsqueda por tema + estadísticas reales de cada video).
 *
 * Dos decisiones que importan:
 *  - **Sin llave no se consulta**: devuelve un aviso en vez de fallar, así la
 *    fuente no ensucia la bandeja de errores en cada ciclo.
 *  - Se busca solo lo **reciente** (últimos 30 días): una tendencia de hace un año
 *    no sirve para decidir qué publicar hoy.
 *
 * La cuota de la API es diaria y gratuita; si se agota, el error se explica tal
 * cual (es lo que hay que mirar cuando "dejó de traer señales").
 */
export class YoutubeConnector implements TrendConnectorPort {
  readonly kind = SourceKind.YOUTUBE_API;
  readonly label = 'YouTube (API oficial)';

  constructor(private readonly apiKey: string) {}

  get isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async fetch(ctx: TrendConnectorContext, signal?: AbortSignal): Promise<ConnectorResult> {
    if (!this.isConfigured) {
      return {
        items: [],
        diagnostics: [],
        warnings: [
          'Falta `YOUTUBE_API_KEY` en el .env: la fuente queda sin recolectar (las demás siguen andando).',
        ],
      };
    }

    const params = readParams(ctx.params);
    const delayMs = ctx.limits?.delayMs ?? DEFAULT_DELAY_MS;
    const perKeyword = Math.max(1, Math.ceil(params.maxItems / params.keywords.length));
    const publishedAfter = new Date(Date.now() - SEARCH_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const items: SignalDraft[] = [];
    const warnings: string[] = [];

    for (const keyword of params.keywords) {
      try {
        const videoIds = await this.search(keyword, perKeyword, params.region, publishedAfter, signal);
        const videos = videoIds.length > 0 ? await this.videoStats(videoIds, signal) : [];

        for (const video of videos) {
          items.push({
            kind: SignalKind.VIDEO,
            url: `https://www.youtube.com/watch?v=${video.id}`,
            title: video.title,
            author: video.channel,
            platform: 'YOUTUBE',
            publishedAt: video.publishedAt,
            region: params.region,
            keywords: [keyword],
            metrics: video.metrics,
            summary: video.description,
            raw: { keyword },
          });
        }

        if (videos.length === 0) {
          warnings.push(`Sin resultados recientes para "${keyword}".`);
        }
      } catch (error) {
        warnings.push(`"${keyword}": ${error instanceof Error ? error.message : String(error)}`);
      }

      await delay(delayMs, signal);
    }

    // Si NINGÚN tema trajo nada Y además hubo errores, la fuente está inutilizable:
    // mejor que la corrida quede FAILED con el motivo.
    if (items.length === 0 && warnings.length === params.keywords.length) {
      throw new Error(`Ningún tema se pudo consultar: ${warnings.join(' | ')}`);
    }

    return { items: items.slice(0, params.maxItems), warnings, diagnostics: [] };
  }

  private async search(
    keyword: string,
    maxResults: number,
    region: string,
    publishedAfter: string,
    signal?: AbortSignal,
  ): Promise<string[]> {
    const url = new URL(`${API_BASE}/search`);
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('type', 'video');
    url.searchParams.set('q', keyword);
    url.searchParams.set('maxResults', String(maxResults));
    url.searchParams.set('regionCode', region);
    url.searchParams.set('relevanceLanguage', 'es');
    url.searchParams.set('order', 'relevance');
    url.searchParams.set('publishedAfter', publishedAfter);
    url.searchParams.set('key', this.apiKey);

    const payload = await this.getJson(url, signal);
    const entries = (payload.items ?? []) as Array<{ id?: { videoId?: string } }>;

    return entries
      .map((entry) => entry.id?.videoId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
  }

  private async videoStats(videoIds: string[], signal?: AbortSignal) {
    const url = new URL(`${API_BASE}/videos`);
    url.searchParams.set('part', 'snippet,statistics');
    url.searchParams.set('id', videoIds.join(','));
    url.searchParams.set('key', this.apiKey);

    const payload = await this.getJson(url, signal);
    const entries = (payload.items ?? []) as Array<{
      id?: string;
      snippet?: { title?: string; channelTitle?: string; publishedAt?: string; description?: string };
      statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
    }>;

    return entries
      .filter((entry) => typeof entry.id === 'string')
      .map((entry) => ({
        id: entry.id as string,
        title: entry.snippet?.title ?? '(sin título)',
        channel: entry.snippet?.channelTitle ?? null,
        publishedAt: entry.snippet?.publishedAt ? new Date(entry.snippet.publishedAt) : null,
        description: entry.snippet?.description?.slice(0, 400) ?? null,
        metrics: {
          views: toNumber(entry.statistics?.viewCount),
          likes: toNumber(entry.statistics?.likeCount),
          comments: toNumber(entry.statistics?.commentCount),
        },
      }));
  }

  private async getJson(url: URL, signal?: AbortSignal): Promise<{ items?: unknown[] }> {
    const response = await fetch(url, { signal });
    const body = await response.text();

    if (!response.ok) {
      throw new Error(describeYoutubeError(body, response.status));
    }

    try {
      return JSON.parse(body) as { items?: unknown[] };
    } catch {
      throw new Error('YouTube devolvió algo que no es JSON (¿cambió la API?).');
    }
  }
}

function readParams(params: Record<string, unknown>): YoutubeParams {
  const keywords = Array.isArray(params.keywords)
    ? params.keywords.filter((value): value is string => typeof value === 'string' && value.length > 0)
    : [];
  if (keywords.length === 0) throw new Error('La fuente de YouTube no tiene `params.keywords`.');

  return {
    keywords,
    region: typeof params.region === 'string' && params.region.length === 2 ? params.region : 'CO',
    maxItems: typeof params.maxItems === 'number' ? params.maxItems : 25,
  };
}

/** El motivo del error de Google, sin el ruido del JSON. */
function describeYoutubeError(body: string, status: number): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string; errors?: Array<{ reason?: string }> } };
    const reason = parsed.error?.errors?.[0]?.reason;
    const message = parsed.error?.message ?? `HTTP ${status}`;
    if (reason === 'quotaExceeded' || /quota/i.test(message)) {
      return `Se agotó la cuota diaria de YouTube API (se renueva a medianoche del Pacífico): ${message}`;
    }
    return `${message} (${reason ?? status})`;
  } catch {
    return `YouTube respondió HTTP ${status}`;
  }
}

function toNumber(value: string | undefined): number {
  const parsed = Number(value ?? '0');
  return Number.isFinite(parsed) ? parsed : 0;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
