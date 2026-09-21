import { describe, expect, it } from 'vitest';
import { ConnectorResultSchema, SignalDraftSchema } from './signal-draft.schema';

/**
 * El contrato de conectores es la frontera con terceros: si esto cambia, cambia
 * el pipeline entero. Por eso se fija con tests.
 */
describe('SignalDraftSchema', () => {
  const minimal = {
    kind: 'TREND',
    url: 'https://example.com/algo',
    title: 'Una tendencia',
  };

  it('acepta el mínimo y completa los campos opcionales', () => {
    const parsed = SignalDraftSchema.parse(minimal);
    expect(parsed.keywords).toEqual([]);
    expect(parsed.metrics).toEqual({});
    expect(parsed.raw).toEqual({});
    expect(parsed.author).toBeUndefined();
    expect(parsed.platform).toBeUndefined();
  });

  it('convierte publishedAt a Date y valida la plataforma', () => {
    const parsed = SignalDraftSchema.parse({
      ...minimal,
      publishedAt: '2026-09-18T14:00:00.000Z',
      platform: 'INSTAGRAM',
    });
    expect(parsed.publishedAt).toBeInstanceOf(Date);
    expect(parsed.platform).toBe('INSTAGRAM');
  });

  it('rechaza una URL que no es URL', () => {
    expect(() => SignalDraftSchema.parse({ ...minimal, url: 'no-es-url' })).toThrow();
  });

  it('rechaza un título vacío', () => {
    expect(() => SignalDraftSchema.parse({ ...minimal, title: '' })).toThrow();
  });

  it('rechaza una plataforma o un kind inexistente', () => {
    expect(() => SignalDraftSchema.parse({ ...minimal, platform: 'MYSPACE' })).toThrow();
    expect(() => SignalDraftSchema.parse({ ...minimal, kind: 'CUALQUIERA' })).toThrow();
  });

  it('acepta LinkedIn (la red del catálogo, sin tocar el schema)', () => {
    // Antes era un enum de Prisma: sumarla era una migración. Ahora el catálogo
    // manda y el conector la acepta sin cambios.
    expect(SignalDraftSchema.parse({ ...minimal, platform: 'LINKEDIN' }).platform).toBe('LINKEDIN');
  });

  it('rechaza métricas que no son números', () => {
    expect(() => SignalDraftSchema.parse({ ...minimal, metrics: { views: 'muchas' } })).toThrow();
  });
});

describe('ConnectorResultSchema', () => {
  it('acepta una corrida sin items y con avisos (fuente no fatal)', () => {
    const parsed = ConnectorResultSchema.parse({
      items: [],
      warnings: ['YOUTUBE_API_KEY vacía: el conector no corrió.'],
    });
    expect(parsed.items).toHaveLength(0);
    expect(parsed.warnings).toHaveLength(1);
  });

  it('default de warnings vacío', () => {
    expect(ConnectorResultSchema.parse({ items: [] }).warnings).toEqual([]);
  });

  it('rechaza un item inválido dentro del lote', () => {
    expect(() =>
      ConnectorResultSchema.parse({ items: [{ kind: 'VIDEO', url: 'x', title: 'y' }] }),
    ).toThrow();
  });
});
