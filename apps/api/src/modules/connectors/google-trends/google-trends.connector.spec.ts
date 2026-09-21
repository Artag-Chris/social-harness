import { SignalKind, SourceKind } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPage } from '../engine/fetch-page';
import { GoogleTrendsConnector, readTrends } from './google-trends.connector';

vi.mock('../engine/fetch-page', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../engine/fetch-page')>();
  return { ...actual, fetchPage: vi.fn() };
});

const fetchPageMock = vi.mocked(fetchPage);

/** El endpoint real antepone `)]}',` al JSON (protección anti-JSON-hijacking). */
const BODY = `)]}',
{"default":{"trendingSearchesDays":[{"trendingSearches":[
  {"title":{"query":"inteligencia artificial"},"formattedTraffic":"200K+","relatedQueries":[{"query":"chatgpt"},{"query":"prompt"}],"articles":[{"title":"Una nota sobre IA"},{"title":"Otra nota"}]},
  {"title":{"query":"futbol"},"formattedTraffic":"100K+"},
  {"title":{"query":"sin titulo"}}
]}]}}`;

function page(body = BODY, status = 200) {
  return { status, contentType: 'application/json', body, finalUrl: 'https://trends.google.com/x', bytes: body.length };
}

function context(params: Record<string, unknown>) {
  return { requestId: 'r', sourceId: 's', sourceName: 'Trends', params, limits: {} };
}

describe('readTrends', () => {
  it('lee el payload real (con el prefijo anti-hijacking)', () => {
    const trends = readTrends(BODY);

    expect(trends).toHaveLength(3);
    expect(trends[0]).toMatchObject({ query: 'inteligencia artificial', traffic: 200_000 });
    expect(trends[0]?.related).toEqual(['chatgpt', 'prompt']);
    expect(trends[0]?.articles).toEqual(['Una nota sobre IA', 'Otra nota']);
  });

  it('descarta las entradas sin consulta y no rompe con basura', () => {
    expect(readTrends(BODY)).toHaveLength(3);
    expect(readTrends('<html>bloqueado</html>')).toEqual([]);
    expect(readTrends('')).toEqual([]);
  });
});

describe('GoogleTrendsConnector', () => {
  beforeEach(() => {
    fetchPageMock.mockReset();
  });

  it('emite una señal por tendencia, con la URL de Trends como identidad estable', async () => {
    fetchPageMock.mockResolvedValue(page() as never);
    const connector = new GoogleTrendsConnector('CO');

    const result = await connector.fetch(context({ region: 'CO' }) as never);

    expect(connector.kind).toBe(SourceKind.GOOGLE_TRENDS);
    expect(result.items).toHaveLength(3);
    expect(result.items[0]).toMatchObject({
      kind: SignalKind.TREND,
      title: 'inteligencia artificial',
      url: 'https://trends.google.com/trends/explore?geo=CO&q=inteligencia%20artificial',
      region: 'CO',
      metrics: { approxTraffic: 200_000 },
    });
    expect(result.items[0]?.keywords).toContain('chatgpt');
    expect(result.items[0]?.summary).toContain('Consultas relacionadas');
  });

  it('filtra por los temas del perfil y avisa si ninguno matchea', async () => {
    fetchPageMock.mockResolvedValue(page() as never);
    const connector = new GoogleTrendsConnector('CO');

    const matched = await connector.fetch(context({ keywords: ['inteligencia'], region: 'CO' }) as never);
    expect(matched.items).toHaveLength(1);

    const none = await connector.fetch(context({ keywords: ['astronomia'], region: 'CO' }) as never);
    expect(none.items).toHaveLength(0);
    expect(none.warnings.join(' ')).toContain('Ninguna de las 3 tendencias');
  });

  it('si el endpoint cambia de formato, lo dice en vez de fallar', async () => {
    fetchPageMock.mockResolvedValue(page('<html>otra cosa</html>') as never);
    const connector = new GoogleTrendsConnector('CO');

    const result = await connector.fetch(context({ region: 'CO' }) as never);

    expect(result.items).toHaveLength(0);
    expect(result.warnings.join(' ')).toContain('no oficial');
  });

  it('un HTTP de error sí hace fallar la corrida', async () => {
    fetchPageMock.mockResolvedValue(page('nope', 429) as never);
    const connector = new GoogleTrendsConnector('CO');

    await expect(connector.fetch(context({ region: 'CO' }) as never)).rejects.toThrow(/429/);
  });
});
