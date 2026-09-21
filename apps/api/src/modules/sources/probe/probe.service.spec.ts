import { BadRequestException } from '@nestjs/common';
import { SourceKind } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPage } from '../../connectors/engine/fetch-page';
import { ProbeService, looksLikeChallenge } from './probe.service';

/**
 * Solo se reemplaza la parte de red: el resto (validación de params, parseo,
 * diagnóstico) es el código real, que es lo que el usuario ve al verificar una
 * fuente.
 */
vi.mock('../../connectors/engine/fetch-page', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../connectors/engine/fetch-page')>();
  return { ...actual, fetchPage: vi.fn() };
});

const fetchPageMock = vi.mocked(fetchPage);

const RSS_BODY = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Feed</title>
  <item><title>Uno</title><link>https://ejemplo.com/1</link><pubDate>Fri, 18 Sep 2026 14:00:00 GMT</pubDate></item>
</channel></rss>`;

const TRENDS_HTML = `<div class="trend-card">
  <h2 class="trend-card__title">Reels que retienen</h2>
  <a class="trend-card__link" href="/reels">Ver</a>
  <span class="trend-card__views">1.2M</span>
</div>`;

const RECIPE = {
  selectors: { item: '.trend-card', title: '.trend-card__title', url: '.trend-card__link', metrics: '.trend-card__views' },
};

describe('ProbeService', () => {
  const service = new ProbeService();

  beforeEach(() => {
    fetchPageMock.mockReset();
  });

  it('RSS: verifica contra el feed y devuelve previsualización', async () => {
    fetchPageMock.mockResolvedValue({
      status: 200,
      contentType: 'application/rss+xml',
      body: RSS_BODY,
      finalUrl: 'https://ejemplo.com/feed.xml',
      bytes: RSS_BODY.length,
    });

    const result = await service.probe({
      kind: SourceKind.RSS,
      params: { feedUrl: 'https://ejemplo.com/feed.xml' },
    });

    expect(result.verified).toBe(true);
    expect(result.itemsFound).toBe(1);
    expect(result.preview[0]?.title).toBe('Uno');
    expect(result.fetched?.status).toBe(200);
  });

  it('RSS: si el feed responde pero viene vacío, no lo da por verificado', async () => {
    fetchPageMock.mockResolvedValue({
      status: 200,
      contentType: 'application/rss+xml',
      body: '<?xml version="1.0"?><rss version="2.0"><channel><title>Vacío</title></channel></rss>',
      finalUrl: 'https://ejemplo.com/feed.xml',
      bytes: 10,
    });

    const result = await service.probe({
      kind: SourceKind.RSS,
      params: { feedUrl: 'https://ejemplo.com/feed.xml' },
    });

    expect(result.verified).toBe(false);
    expect(result.warnings.join(' ')).toContain('no traía items');
  });

  it('RSS: un error de red se reporta como advertencia, no como excepción', async () => {
    fetchPageMock.mockRejectedValue(new Error('No se pudo conectar: ENOTFOUND'));

    const result = await service.probe({
      kind: SourceKind.RSS,
      params: { feedUrl: 'https://no-existe.invalid/feed' },
    });

    expect(result.verified).toBe(false);
    expect(result.warnings[0]).toContain('No se pudo conectar');
  });

  it('RSS: un 404 se reporta con el código', async () => {
    fetchPageMock.mockResolvedValue({
      status: 404,
      contentType: 'text/html',
      body: 'not found',
      finalUrl: 'https://ejemplo.com/x',
      bytes: 9,
    });

    const result = await service.probe({
      kind: SourceKind.RSS,
      params: { feedUrl: 'https://ejemplo.com/x' },
    });

    expect(result.warnings[0]).toContain('HTTP 404');
  });

  it('Página pública: lee la receta y devuelve el diagnóstico por selector', async () => {
    fetchPageMock.mockResolvedValue({
      status: 200,
      contentType: 'text/html',
      body: TRENDS_HTML,
      finalUrl: 'https://ejemplo.com/tendencias',
      bytes: TRENDS_HTML.length,
    });

    const result = await service.probe({
      kind: SourceKind.PUBLIC_WEB,
      params: { listUrl: 'https://ejemplo.com/tendencias', recipe: RECIPE },
    });

    expect(result.verified).toBe(true);
    expect(result.itemsFound).toBe(1);
    expect(result.preview[0]).toMatchObject({
      title: 'Reels que retienen',
      url: 'https://ejemplo.com/reels',
      metrics: { metric: 1_200_000 },
    });
    expect(result.diagnostics?.find((d) => d.field === 'item')?.matched).toBe(1);
  });

  it('Página pública: detecta una página de challenge y lo explica', async () => {
    fetchPageMock.mockResolvedValue({
      status: 403,
      contentType: 'text/html',
      body: '<html><head><title>Just a moment...</title><script src="https://challenges.cloudflare.com/x"></script></head></html>',
      finalUrl: 'https://ejemplo.com/t',
      bytes: 120,
    });

    const result = await service.probe({
      kind: SourceKind.PUBLIC_WEB,
      params: { listUrl: 'https://ejemplo.com/tendencias', recipe: RECIPE },
    });

    expect(result.verified).toBe(false);
    expect(result.warnings.join(' ')).toMatch(/anti-bot|challenge/i);
  });

  it('manual: no recolecta nada y lo dice', async () => {
    const result = await service.probe({ kind: SourceKind.MANUAL, params: {} });

    expect(result.verified).toBe(true);
    expect(result.warnings[0]).toContain('pegar inspiración');
  });

  it('YouTube: avisa que no se puede verificar todavía y si falta la llave', async () => {
    const result = await service.probe({
      kind: SourceKind.YOUTUBE_API,
      params: { keywords: ['ia'], region: 'CO', maxItems: 25 },
    });

    expect(result.verified).toBe(false);
    expect(result.warnings.join(' ')).toContain('fase 2');
  });

  it('params con la forma equivocada devuelven 400 con el campo que falla', async () => {
    await expect(service.probe({ kind: SourceKind.RSS, params: { keywords: ['ia'] } })).rejects.toThrow(
      BadRequestException,
    );

    try {
      await service.probe({ kind: SourceKind.RSS, params: {} });
    } catch (error) {
      const response = (error as BadRequestException).getResponse() as {
        issues: Array<{ field: string }>;
      };
      expect(response.issues[0]?.field).toBe('feedUrl');
    }
  });
});

describe('looksLikeChallenge', () => {
  it('reconoce las señales típicas de Cloudflare y compañía', () => {
    expect(looksLikeChallenge('<script src="https://challenges.cloudflare.com/turnstile"></script>')).toBe(true);
    expect(looksLikeChallenge('<title>Just a moment...</title>')).toBe(true);
    expect(looksLikeChallenge('<title>Attention Required! | Cloudflare</title>')).toBe(true);
    expect(looksLikeChallenge('<html><body>contenido normal</body></html>')).toBe(false);
  });
});
