import { SourceKind } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { features } from '../../config/features';
import { ProbeInputSchema, SourceInputSchema, parseParams } from './sources.schema';

/**
 * Cada tipo de fuente tiene sus propios `params`, y eso se exige en el borde: si
 * se colara un `params` de otro tipo, el conector fallaría recién en la
 * recolección (mucho más caro de descubrir).
 */
describe('SourceInputSchema', () => {
  const base = { name: 'Mi fuente' };

  it('aplica los defaults comunes (cadencia del entorno, habilitada, límites vacíos)', () => {
    const parsed = SourceInputSchema.parse({
      ...base,
      kind: SourceKind.RSS,
      params: { feedUrl: 'https://ejemplo.com/feed.xml' },
    });

    expect(parsed.enabled).toBe(true);
    expect(parsed.intervalHours).toBe(features.scheduler.sourceDefaultIntervalHours);
    expect(parsed.limits).toEqual({});
    expect(parsed.params).toEqual({ feedUrl: 'https://ejemplo.com/feed.xml', maxItems: 20 });
  });

  it('RSS exige una URL http(s)', () => {
    expect(() =>
      SourceInputSchema.parse({ ...base, kind: SourceKind.RSS, params: { feedUrl: 'ftp://x.com/a' } }),
    ).toThrow(z.ZodError);
    expect(() => SourceInputSchema.parse({ ...base, kind: SourceKind.RSS, params: {} })).toThrow(
      z.ZodError,
    );
  });

  it('YouTube y Trends exigen al menos un tema', () => {
    expect(() =>
      SourceInputSchema.parse({ ...base, kind: SourceKind.YOUTUBE_API, params: { keywords: [] } }),
    ).toThrow(z.ZodError);

    const ok = SourceInputSchema.parse({
      ...base,
      kind: SourceKind.GOOGLE_TRENDS,
      params: { keywords: ['ia'], region: 'CO' },
    });
    expect(ok.kind).toBe(SourceKind.GOOGLE_TRENDS);
  });

  it('Página pública exige la receta con el contenedor `item`', () => {
    expect(() =>
      SourceInputSchema.parse({
        ...base,
        kind: SourceKind.PUBLIC_WEB,
        params: { listUrl: 'https://x.com/t', recipe: { selectors: {} } },
      }),
    ).toThrow(/obligatorio/);

    const ok = SourceInputSchema.parse({
      ...base,
      kind: SourceKind.PUBLIC_WEB,
      params: {
        listUrl: 'https://x.com/t',
        recipe: { selectors: { item: '.card', title: '.card__title' } },
      },
    });
    expect(ok.kind).toBe(SourceKind.PUBLIC_WEB);
  });

  it('rechaza un tipo de fuente que no existe', () => {
    expect(() => SourceInputSchema.parse({ ...base, kind: 'TELEPATIA', params: {} })).toThrow(
      z.ZodError,
    );
  });

  it('rechaza límites fuera de rango (no se le puede pedir 10 000 páginas al portal)', () => {
    expect(() =>
      SourceInputSchema.parse({
        ...base,
        kind: SourceKind.RSS,
        params: { feedUrl: 'https://x.com/f' },
        limits: { maxPages: 10_000 },
      }),
    ).toThrow(z.ZodError);
  });

  it('manual no necesita params', () => {
    const parsed = SourceInputSchema.parse({ ...base, kind: SourceKind.MANUAL, params: {} });
    expect(parsed.kind).toBe(SourceKind.MANUAL);
  });
});

describe('parseParams', () => {
  it('valida contra el tipo que ya tiene la fuente (se usa en el PATCH y en el probe)', () => {
    expect(parseParams(SourceKind.RSS, { feedUrl: 'https://x.com/f' })).toEqual({
      feedUrl: 'https://x.com/f',
      maxItems: 20,
    });

    expect(() => parseParams(SourceKind.RSS, { keywords: ['ia'] })).toThrow(z.ZodError);
  });
});

describe('ProbeInputSchema', () => {
  it('acepta params sin validar la forma (los valida el probe según el tipo)', () => {
    const parsed = ProbeInputSchema.parse({ kind: SourceKind.RSS, params: {} });
    expect(parsed.params).toEqual({});
  });
});
