import { describe, expect, it } from 'vitest';
import { parseMetricNumber, parseRecipe } from './parse-recipe';

/**
 * El motor de recetas es lo que hace usable el scraping genérico: si esto lee mal
 * la página, el usuario guarda una fuente que no trae nada.
 */
const HTML = `
<main>
  <article class="trend-card">
    <h2 class="trend-card__title">Cómo estructurar un reel</h2>
    <a class="trend-card__link" href="/reel-hook">Ver</a>
    <span class="trend-card__author">@creador_uno</span>
    <span class="trend-card__views">1.2M</span>
    <span class="trend-card__tag">reels</span>
    <time class="trend-card__date" datetime="2026-09-18">18 sep</time>
  </article>
  <article class="trend-card">
    <h2 class="trend-card__title">Shorts de 45 segundos</h2>
    <a class="trend-card__link" href="https://ejemplo.com/shorts-45">Ver</a>
    <span class="trend-card__views">870K</span>
    <time class="trend-card__date" datetime="2026-09-17">17 sep</time>
  </article>
  <article class="trend-card">
    <span class="trend-card__views">sin título ni link</span>
  </article>
</main>
`;

const RECIPE = {
  selectors: {
    item: '.trend-card',
    title: '.trend-card__title',
    url: '.trend-card__link',
    author: '.trend-card__author',
    metrics: '.trend-card__views',
    postedAt: '.trend-card__date',
  },
};

describe('parseRecipe', () => {
  it('lee los items y absolutiza las URLs relativas contra la página', () => {
    const result = parseRecipe(HTML, RECIPE, 'https://ejemplo.com/tendencias');

    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      title: 'Cómo estructurar un reel',
      url: 'https://ejemplo.com/reel-hook',
      author: '@creador_uno',
      metrics: { metric: 1_200_000 },
    });
    expect(result.items[1]?.url).toBe('https://ejemplo.com/shorts-45');
  });

  it('convierte la fecha a ISO cuando el contenedor la trae', () => {
    const result = parseRecipe(HTML, RECIPE, 'https://ejemplo.com/t');

    expect(result.items[0]?.publishedAt).toBe(new Date('2026-09-18').toISOString());
  });

  it('descarta el contenedor sin título ni enlace y lo avisa', () => {
    const result = parseRecipe(HTML, RECIPE, 'https://ejemplo.com/t');

    expect(result.items).toHaveLength(2);
    expect(result.warnings.join(' ')).toContain('no tenían título ni enlace');
  });

  it('devuelve diagnóstico por selector (para depurar una receta que no trae nada)', () => {
    const result = parseRecipe(HTML, RECIPE, 'https://ejemplo.com/t');
    const byField = Object.fromEntries(result.diagnostics.map((d) => [d.field, d.matched]));

    expect(byField.item).toBe(3);
    expect(byField.title).toBe(2);
    expect(byField.url).toBe(2);
    expect(byField.metrics).toBe(3);
  });

  it('si el contenedor no existe, lo dice explícitamente', () => {
    const result = parseRecipe('<html><body>Nada</body></html>', RECIPE, 'https://ejemplo.com/t');

    expect(result.items).toHaveLength(0);
    expect(result.warnings.join(' ')).toContain('no encontró nada');
  });

  it('si no se define selector de url, usa el primer enlace del contenedor', () => {
    const result = parseRecipe(
      '<div class="card"><a href="/a">A</a><h3>Título</h3></div>',
      { selectors: { item: '.card', title: 'h3' } },
      'https://ejemplo.com/base',
    );

    expect(result.items[0]?.url).toBe('https://ejemplo.com/a');
  });

  it('un título sin enlace ni url de item igual entra (título vacío no)', () => {
    const result = parseRecipe(
      '<div class="card"><h3>Solo título</h3></div>',
      { selectors: { item: '.card', title: 'h3' } },
      'https://ejemplo.com/base',
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.url).toBe('');
  });
});

describe('parseMetricNumber', () => {
  it('entiende los formatos que usan los portales', () => {
    expect(parseMetricNumber('1.2M')).toBe(1_200_000);
    expect(parseMetricNumber('870K')).toBe(870_000);
    expect(parseMetricNumber('2B')).toBe(2_000_000_000);
    expect(parseMetricNumber('1.200')).toBe(1200);
    expect(parseMetricNumber('1,5M')).toBe(1_500_000);
    expect(parseMetricNumber('310')).toBe(310);
  });

  it('devuelve undefined cuando no hay número (no inventa un 0)', () => {
    expect(parseMetricNumber('muchas')).toBeUndefined();
    expect(parseMetricNumber('')).toBeUndefined();
  });
});
