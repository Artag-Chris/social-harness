import { describe, expect, it } from 'vitest';
import { prefilter, scoreSignal, topMetric, type ProfileForScoring, type SignalForScoring } from './relevance.prefilter';

/**
 * El prefilter es el freno de costo del análisis: ordena y recorta antes de gastar
 * IA. Y su score es el respaldo cuando no hay proveedor, así que las dos cosas se
 * prueban acá.
 */
const profile: ProfileForScoring = { niche: ['inteligencia artificial', 'automatizacion'], platforms: ['LINKEDIN'] };

function signal(overrides: Partial<SignalForScoring> = {}): SignalForScoring {
  return {
    title: 'Un título cualquiera',
    summary: null,
    keywords: [],
    platform: null,
    publishedAt: new Date(),
    createdAt: new Date(),
    metrics: {},
    ...overrides,
  };
}

describe('scoreSignal', () => {
  it('lo que toca el nicho puntúa alto y lo explica', () => {
    const result = scoreSignal(
      profile,
      signal({ title: 'Cómo usar inteligencia artificial en tu pyme', platform: 'LINKEDIN' }),
    );

    expect(result.score).toBeGreaterThanOrEqual(60);
    expect(result.reasons.join(' ')).toContain('nicho');
    expect(result.reasons.join(' ')).toContain('LINKEDIN');
  });

  it('lo que no toca el nicho queda bajo, aunque sea reciente', () => {
    const result = scoreSignal(profile, signal({ title: 'Receta de arepas' }));

    expect(result.score).toBeLessThan(30);
    expect(result.reasons.join(' ')).not.toContain('nicho');
  });

  it('busca el nicho también en el resumen y en los temas', () => {
    expect(scoreSignal(profile, signal({ summary: 'Hablamos de automatizacion' })).score).toBeGreaterThan(20);
    expect(scoreSignal(profile, signal({ keywords: ['automatizacion'] })).score).toBeGreaterThan(20);
  });

  it('premia la frescura por tramos', () => {
    const now = new Date('2026-09-22T12:00:00Z');
    const hace = (dias: number): Date => new Date(now.getTime() - dias * 86_400_000);

    const deHoy = scoreSignal(profile, signal({ publishedAt: hace(0) }), now);
    const deLaSemana = scoreSignal(profile, signal({ publishedAt: hace(5) }), now);
    const delMes = scoreSignal(profile, signal({ publishedAt: hace(20) }), now);
    const viejo = scoreSignal(profile, signal({ publishedAt: hace(90) }), now);

    expect(deHoy.score).toBeGreaterThan(deLaSemana.score);
    expect(deLaSemana.score).toBeGreaterThan(delMes.score);
    expect(delMes.score).toBeGreaterThan(viejo.score);
  });

  it('premia la tracción y la muestra legible', () => {
    const viral = scoreSignal(profile, signal({ metrics: { views: 1_200_000 } }));
    const normal = scoreSignal(profile, signal({ metrics: { views: 500 } }));

    expect(viral.score).toBeGreaterThan(normal.score);
    expect(viral.reasons.join(' ')).toContain('1.2M');
  });

  it('sin métricas numéricas no rompe (ni inventa tracción)', () => {
    expect(scoreSignal(profile, signal({ metrics: { views: 'muchas' } })).reasons.join(' ')).not.toContain('alcance');
  });

  it('no pasa de 100 aunque sume todo', () => {
    const result = scoreSignal(profile, signal({
      title: 'inteligencia artificial y automatizacion',
      summary: 'inteligencia artificial automatizacion',
      platform: 'LINKEDIN',
      metrics: { views: 5_000_000 },
    }));

    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('usa la fecha de creación si la señal no trae fecha de publicación', () => {
    const now = new Date('2026-09-22T12:00:00Z');
    const result = scoreSignal(profile, signal({ publishedAt: null, createdAt: now }), now);

    expect(result.reasons.join(' ')).toContain('reciente');
  });
});

describe('prefilter', () => {
  it('ordena por puntaje y recorta al lote', () => {
    const now = new Date('2026-09-22T12:00:00Z');
    const señales = [
      signal({ title: 'Receta de arepas', publishedAt: now }),
      signal({ title: 'inteligencia artificial en la pyme', publishedAt: now }),
      signal({ title: 'automatizacion de procesos', publishedAt: now }),
    ];

    const result = prefilter(profile, señales, 2, now);

    expect(result).toHaveLength(2);
    expect(result[0]?.relevance.score).toBeGreaterThanOrEqual(result[1]?.relevance.score ?? 0);
    expect(result.map((entry) => entry.signal.title)).not.toContain('Receta de arepas');
  });

  it('con límite mayor que la cantidad devuelve todo', () => {
    expect(prefilter(profile, [signal(), signal()], 10)).toHaveLength(2);
  });
});

describe('topMetric', () => {
  it('toma la métrica más alta de las numéricas', () => {
    expect(topMetric({ views: 100, likes: 5000, comments: 3 })).toBe(5000);
    expect(topMetric({})).toBe(0);
    expect(topMetric({ views: Number.NaN })).toBe(0);
  });
});
