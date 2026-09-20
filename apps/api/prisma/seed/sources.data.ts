/**
 * Fuentes que siembra el seed.
 *
 * Decisión deliberada (misma lección que cv-harness): **no** se siembran fuentes
 * que dependan de una llave (por ejemplo una de `YOUTUBE_API` sin
 * `YOUTUBE_API_KEY`) porque serían fuentes que fallan siempre y ensucian la
 * bandeja de notificaciones. Esas se crean desde la pestaña Fuentes, donde el
 * probe las verifica antes de guardarlas.
 *
 * Lo que sí se siembra son las fuentes del **fixture E2E** (profile "fixture" de
 * docker compose): RSS y una página HTML servida por nginx. Permiten correr el
 * pipeline completo sin red, sin llaves y sin tocar ningún portal real.
 */

interface FixtureSource {
  id: string;
  name: string;
  kind: 'RSS' | 'PUBLIC_WEB';
  params: Record<string, unknown>;
  limits: Record<string, unknown>;
  intervalHours: number;
}

/**
 * Receta CSS del conector PUBLIC_WEB apuntando al fixture.
 * Es el mismo contrato que usaría una página pública real de tendencias:
 * selectores + política de cortesía (límites).
 */
const FIXTURE_RECIPE = {
  selectors: {
    item: '.trend-card',
    title: '.trend-card__title',
    url: '.trend-card__link',
    author: '.trend-card__author',
    metrics: '.trend-card__views',
    keywords: '.trend-card__tag',
    postedAt: '.trend-card__date',
  },
  limits: {
    maxPages: 1,
    delayMs: 500,
    timeoutMs: 15000,
    respectRobots: true,
  },
};

export function fixtureSources(baseUrl: string, intervalHours: number): FixtureSource[] {
  const base = baseUrl.replace(/\/+$/, '');

  return [
    {
      id: 'seed_source_fixture_feed',
      name: 'Nicho — feed (fixture)',
      kind: 'RSS',
      params: { feedUrl: `${base}/feed.xml`, maxItems: 20 },
      limits: { timeoutMs: 15000 },
      intervalHours,
    },
    {
      id: 'seed_source_fixture_news',
      name: 'Nicho — noticias (fixture)',
      kind: 'RSS',
      // Este feed repite un enlace de feed.xml con ?utm_* distinto: sirve para
      // comprobar que el dedup por URL canónica los une en UNA sola señal.
      params: { feedUrl: `${base}/news.xml`, maxItems: 20 },
      limits: { timeoutMs: 15000 },
      intervalHours,
    },
    {
      id: 'seed_source_fixture_trends',
      name: 'Tendencias — página pública (fixture)',
      kind: 'PUBLIC_WEB',
      params: { listUrl: `${base}/trends.html`, recipe: FIXTURE_RECIPE },
      limits: FIXTURE_RECIPE.limits,
      intervalHours,
    },
  ];
}
