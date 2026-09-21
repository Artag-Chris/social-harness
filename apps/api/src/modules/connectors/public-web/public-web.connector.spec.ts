import { SignalKind, SourceKind } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPage } from '../engine/fetch-page';
import { PublicWebConnector } from './public-web.connector';

vi.mock('../engine/fetch-page', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../engine/fetch-page')>();
  return { ...actual, fetchPage: vi.fn() };
});

const fetchPageMock = vi.mocked(fetchPage);

const HTML = `<div class="trend-card">
  <h2 class="trend-card__title">Reels que retienen</h2>
  <a class="trend-card__link" href="/reels">Ver</a>
  <span class="trend-card__views">1.2M</span>
</div>`;

const RECIPE = {
  selectors: { item: '.trend-card', title: '.trend-card__title', url: '.trend-card__link', metrics: '.trend-card__views' },
};

function context(params: Record<string, unknown>) {
  return {
    requestId: 'req-1',
    sourceId: 'src-1',
    sourceName: 'Página',
    params,
    limits: {},
  };
}

describe('PublicWebConnector', () => {
  const connector = new PublicWebConnector();

  beforeEach(() => {
    fetchPageMock.mockReset();
  });

  it('usa la receta y devuelve señales de tendencia con su métrica', async () => {
    fetchPageMock.mockResolvedValue({
      status: 200,
      contentType: 'text/html',
      body: HTML,
      finalUrl: 'https://ejemplo.com/tendencias',
      bytes: HTML.length,
    } as never);

    const result = await connector.fetch(
      context({ listUrl: 'https://ejemplo.com/tendencias', recipe: RECIPE }) as never,
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      kind: SignalKind.TREND,
      title: 'Reels que retienen',
      url: 'https://ejemplo.com/reels',
      metrics: { metric: 1_200_000 },
    });
  });

  it('reporta el diagnóstico por selector y avisa de los que no matchearon', async () => {
    fetchPageMock.mockResolvedValue({
      status: 200,
      contentType: 'text/html',
      body: HTML,
      finalUrl: 'https://ejemplo.com/t',
      bytes: HTML.length,
    } as never);

    const result = await connector.fetch(
      context({
        listUrl: 'https://ejemplo.com/t',
        recipe: { selectors: { item: '.trend-card', title: '.trend-card__title', author: '.no-existe' } },
      }) as never,
    );

    expect(result.diagnostics.find((d) => d.field === 'item')?.matched).toBe(1);
    expect(result.warnings.join(' ')).toContain('"author"');
  });

  it('el tipo declarado es el de página pública', () => {
    expect(connector.kind).toBe(SourceKind.PUBLIC_WEB);
    expect(connector.isConfigured).toBe(true);
  });

  it('sin receta o sin `item` no corre: es un error de configuración', async () => {
    await expect(
      connector.fetch(context({ listUrl: 'https://e.com/t', recipe: { selectors: {} } }) as never),
    ).rejects.toThrow(/item/);
    await expect(connector.fetch(context({ recipe: RECIPE }) as never)).rejects.toThrow(/listUrl/);
  });

  it('un HTTP de error hace fallar la corrida', async () => {
    fetchPageMock.mockResolvedValue({
      status: 403,
      contentType: 'text/html',
      body: 'blocked',
      finalUrl: 'https://e.com/t',
      bytes: 7,
    } as never);

    await expect(
      connector.fetch(context({ listUrl: 'https://e.com/t', recipe: RECIPE }) as never),
    ).rejects.toThrow(/403/);
  });
});
