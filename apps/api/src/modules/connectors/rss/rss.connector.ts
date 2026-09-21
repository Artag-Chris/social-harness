import { SignalKind, SourceKind } from '@prisma/client';
import { fetchPage } from '../engine/fetch-page';
import { parseFeed } from '../engine/parse-feed';
import { fetchOptionsFrom, toSignalDraft } from '../signal-mapping';
import type { ConnectorResult, SignalDraft } from '../signal-draft.schema';
import type { TrendConnectorContext, TrendConnectorPort } from '../trend-connector.port';

interface RssParams {
  feedUrl: string;
  maxItems: number;
}

/**
 * Conector de feeds RSS/Atom: la vía más limpia para las noticias del nicho.
 *
 * No necesita llave ni scraping frágil, así que es la fuente que conviene cargar
 * primero. Los items sin enlace se descartan (no se pueden deduplicar).
 */
export class RssConnector implements TrendConnectorPort {
  readonly kind = SourceKind.RSS;
  readonly label = 'Feed RSS/Atom';
  readonly isConfigured = true;

  async fetch(ctx: TrendConnectorContext, signal?: AbortSignal): Promise<ConnectorResult> {
    const params = readParams(ctx.params);
    const page = await fetchPage(params.feedUrl, {
      ...fetchOptionsFrom(ctx.limits),
      // Un feed no necesita más que esto.
      maxBytes: 5 * 1024 * 1024,
      signal,
    });

    if (page.status >= 400) {
      throw new Error(`El feed respondió HTTP ${page.status}.`);
    }

    const feed = await parseFeed(page.body);
    const warnings = [`Feed "${feed.title}".`, ...feed.warnings];
    const items = feed.items
      .slice(0, params.maxItems)
      .map((item) => toSignalDraft(item, { kind: SignalKind.NEWS, baseUrl: page.finalUrl }))
      .filter((draft): draft is SignalDraft => draft !== null);

    if (items.length === 0) {
      warnings.push('El feed respondió bien pero no traía items usables.');
    }
    if (feed.items.length > items.length) {
      warnings.push(
        `${feed.items.length - items.length} item(s) se descartaron por no tener una URL resoluble.`,
      );
    }

    return { items, warnings, diagnostics: [] };
  }
}

function readParams(params: Record<string, unknown>): RssParams {
  const feedUrl = params.feedUrl;
  if (typeof feedUrl !== 'string' || feedUrl.length === 0) {
    throw new Error('La fuente RSS no tiene `params.feedUrl`.');
  }
  const maxItems = typeof params.maxItems === 'number' ? params.maxItems : 20;
  return { feedUrl, maxItems };
}
