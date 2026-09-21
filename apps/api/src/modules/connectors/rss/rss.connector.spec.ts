import { SignalKind, SourceKind } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPage } from '../engine/fetch-page';
import { RssConnector } from './rss.connector';

vi.mock('../engine/fetch-page', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../engine/fetch-page')>();
  return { ...actual, fetchPage: vi.fn() };
});

const fetchPageMock = vi.mocked(fetchPage);

const FEED = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Nicho</title>
  <item><title>La primera nota</title><link>https://ejemplo.com/1</link><author>Equipo</author><pubDate>Fri, 18 Sep 2026 14:00:00 GMT</pubDate><description>Resumen uno</description></item>
  <item><title>La segunda nota</title><link>https://ejemplo.com/2</link><description>Resumen dos</description></item>
  <item><title>Sin enlace</title><description>No se puede deduplicar</description></item>
</channel></rss>`;

function page(body: string, status = 200) {
  return { status, contentType: 'application/rss+xml', body, finalUrl: 'https://ejemplo.com/feed.xml', bytes: body.length };
}

function context(params: Record<string, unknown> = {}) {
  return {
    requestId: 'req-1',
    sourceId: 'src-1',
    sourceName: 'Feed',
    params,
    limits: {},
  };
}

describe('RssConnector', () => {
  const connector = new RssConnector();

  beforeEach(() => {
    fetchPageMock.mockReset();
  });

  it('declara su tipo y que no necesita credenciales', () => {
    expect(connector.kind).toBe(SourceKind.RSS);
    expect(connector.isConfigured).toBe(true);
  });

  it('convierte los items del feed en señales de tipo noticia', async () => {
    fetchPageMock.mockResolvedValue(page(FEED) as never);

    const result = await connector.fetch(context({ feedUrl: 'https://ejemplo.com/feed.xml' }) as never);

    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      kind: SignalKind.NEWS,
      title: 'La primera nota',
      url: 'https://ejemplo.com/1',
      author: 'Equipo',
      summary: 'Resumen uno',
    });
    expect(result.items[0]?.publishedAt).toBeInstanceOf(Date);
  });

  it('respeta `maxItems`', async () => {
    fetchPageMock.mockResolvedValue(page(FEED) as never);

    const result = await connector.fetch(
      context({ feedUrl: 'https://ejemplo.com/feed.xml', maxItems: 1 }) as never,
    );

    expect(result.items).toHaveLength(1);
  });

  it('avisa del item sin enlace en vez de descartarlo en silencio', async () => {
    fetchPageMock.mockResolvedValue(page(FEED) as never);

    const result = await connector.fetch(context({ feedUrl: 'https://ejemplo.com/feed.xml' }) as never);

    expect(result.warnings.join(' ')).toContain('no traían enlace');
    expect(result.warnings.join(' ')).toContain('Nicho');
  });

  it('un HTTP de error hace fallar la corrida (con el código)', async () => {
    fetchPageMock.mockResolvedValue(page('nope', 404) as never);

    await expect(connector.fetch(context({ feedUrl: 'https://e.com/f' }) as never)).rejects.toThrow(/404/);
  });

  it('sin `feedUrl` en los params falla con un mensaje claro', async () => {
    await expect(connector.fetch(context({}) as never)).rejects.toThrow(/feedUrl/);
  });
});
