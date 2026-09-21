import { SignalKind, SourceKind } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { YoutubeConnector } from './youtube.connector';

/**
 * YouTube es la fuente más rica y la única que necesita llave. Se prueba el mapeo
 * (incluidas las métricas) y los dos modos de falla que importan: sin llave y con
 * la cuota agotada.
 */
const SEARCH = { items: [{ id: { videoId: 'abc123' } }, { id: { videoId: 'def456' } }] };
const VIDEOS = {
  items: [
    {
      id: 'abc123',
      snippet: {
        title: 'Cómo hacer un reel',
        channelTitle: 'Mi canal',
        publishedAt: '2026-09-18T10:00:00.000Z',
        description: 'Descripción del video',
      },
      statistics: { viewCount: '1200', likeCount: '30', commentCount: '5' },
    },
    { id: 'def456', snippet: { title: 'Otro video' }, statistics: { viewCount: '10' } },
  ],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function context(params: Record<string, unknown>, limits: Record<string, unknown> = {}) {
  return {
    requestId: 'req-1',
    sourceId: 'src-1',
    sourceName: 'YouTube',
    params,
    limits: { delayMs: 0, ...limits },
  };
}

describe('YoutubeConnector', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async (url: unknown) => (String(url).includes('/search') ? json(SEARCH) : json(VIDEOS)));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sin llave no consulta nada y lo avisa (no falla la corrida)', async () => {
    const connector = new YoutubeConnector('');

    const result = await connector.fetch(context({ keywords: ['ia'] }) as never);

    expect(connector.isConfigured).toBe(false);
    expect(result.items).toEqual([]);
    expect(result.warnings[0]).toContain('YOUTUBE_API_KEY');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('busca por tema y arma señales de video con sus estadísticas', async () => {
    const connector = new YoutubeConnector('llave');

    const result = await connector.fetch(context({ keywords: ['ia'], region: 'CO' }) as never);

    expect(connector.kind).toBe(SourceKind.YOUTUBE_API);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      kind: SignalKind.VIDEO,
      platform: 'YOUTUBE',
      url: 'https://www.youtube.com/watch?v=abc123',
      title: 'Cómo hacer un reel',
      author: 'Mi canal',
      keywords: ['ia'],
      metrics: { views: 1200, likes: 30, comments: 5 },
    });
  });

  it('busca solo lo reciente (no tendencias de hace un año)', async () => {
    const connector = new YoutubeConnector('llave');

    await connector.fetch(context({ keywords: ['ia'] }) as never);

    const searchUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(searchUrl).toContain('publishedAfter=');
  });

  it('explica el error de cuota tal cual (es lo que se mira cuando deja de traer)', async () => {
    const connector = new YoutubeConnector('llave');
    fetchMock.mockResolvedValue(
      json({ error: { message: 'Quota exceeded', errors: [{ reason: 'quotaExceeded' }] } }, 403),
    );

    await expect(connector.fetch(context({ keywords: ['ia'] }) as never)).rejects.toThrow(/cuota diaria/i);
  });

  it('si un tema falla pero otro trae resultados, sigue y avisa', async () => {
    const connector = new YoutubeConnector('llave');
    let calls = 0;
    fetchMock.mockImplementation(async (url: unknown) => {
      if (String(url).includes('/search')) {
        calls += 1;
        if (calls === 1) return json({ error: { message: 'boom' } }, 500);
        return json(SEARCH);
      }
      return json(VIDEOS);
    });

    const result = await connector.fetch(context({ keywords: ['falla', 'funciona'] }) as never);

    expect(result.items.length).toBeGreaterThan(0);
    expect(result.warnings.join(' ')).toContain('falla');
  });

  it('respeta `maxItems`', async () => {
    const connector = new YoutubeConnector('llave');

    const result = await connector.fetch(context({ keywords: ['ia'], maxItems: 1 }) as never);

    expect(result.items).toHaveLength(1);
  });

  it('sin temas no corre: es un error de configuración', async () => {
    const connector = new YoutubeConnector('llave');

    await expect(connector.fetch(context({}) as never)).rejects.toThrow(/keywords/);
  });
});
