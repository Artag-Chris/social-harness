import { SourceKind } from '@prisma/client';
import { features } from '../../config/features';

/**
 * Plantillas de fuente: el punto de partida para no armar la config a mano.
 *
 * Son ejemplos de params por tipo (los mismos que valida `sources.schema.ts`).
 * La UI las muestra como "elegí un tipo y completá", y el probe verifica el
 * resultado antes de guardarlo.
 */
export interface SourceTemplate {
  id: string;
  label: string;
  kind: SourceKind;
  description: string;
  /** Qué hay que completar antes de guardarla. */
  fillIn?: string;
  /** Variables de entorno que necesita (si falta alguna, la fuente va a avisar). */
  requires?: string[];
  params: Record<string, unknown>;
}

const BASE_TEMPLATES: SourceTemplate[] = [
  {
    id: 'rss-feed',
    label: 'Feed RSS/Atom',
    kind: SourceKind.RSS,
    description: 'Cualquier feed RSS o Atom: un blog, un medio del sector o un podcast.',
    fillIn: 'La URL del feed.',
    params: { feedUrl: 'https://ejemplo.com/feed.xml', maxItems: 20 },
  },
  {
    id: 'google-news',
    label: 'Google News por tema',
    kind: SourceKind.RSS,
    description:
      'Noticias del nicho. Es un RSS: se arma la URL de búsqueda de Google News con tu tema.',
    fillIn: 'Reemplazá `TU+TEMA` por tus palabras (los espacios van con +).',
    params: {
      feedUrl: 'https://news.google.com/rss/search?q=TU+TEMA&hl=es-419&gl=CO&ceid=CO:es-419',
      maxItems: 20,
    },
  },
  {
    id: 'youtube-keyword',
    label: 'YouTube por palabra clave',
    kind: SourceKind.YOUTUBE_API,
    description:
      'Videos y estadísticas de lo que se está moviendo en un tema. La fuente más rica para tendencias.',
    fillIn: 'Los temas a vigilar y la región.',
    requires: ['YOUTUBE_API_KEY'],
    params: { keywords: ['inteligencia artificial'], region: 'CO', maxItems: 25 },
  },
  {
    id: 'google-trends',
    label: 'Google Trends por tema',
    kind: SourceKind.GOOGLE_TRENDS,
    description: 'Interés de búsqueda y consultas relacionadas que están subiendo.',
    fillIn: 'Los temas a vigilar y la región.',
    params: { keywords: ['inteligencia artificial'], region: 'CO' },
  },
  {
    id: 'pagina-publica',
    label: 'Página pública (receta CSS)',
    kind: SourceKind.PUBLIC_WEB,
    description:
      'Una página pública de tendencias o de competencia, leída con selectores CSS. Se prueba antes de guardar.',
    fillIn: 'La URL y los selectores (mínimo el contenedor `item`).',
    params: {
      listUrl: 'https://ejemplo.com/tendencias',
      recipe: {
        selectors: {
          item: '.card',
          title: '.card__title',
          url: '.card__link',
          author: '.card__author',
          metrics: '.card__views',
          keywords: '.card__tag',
          postedAt: '.card__date',
        },
      },
    },
  },
  {
    id: 'manual',
    label: 'Manual (inspiración / competencia)',
    kind: SourceKind.MANUAL,
    description:
      'No recolecta nada solo: es el espacio donde pegás URLs o textos de lo que no se puede automatizar (LinkedIn, un post que funcionó).',
    params: {},
  },
];

/**
 * Plantillas del fixture E2E: solo aparecen con `FIXTURE_ENABLED=true` (dev).
 * Sirven para probar el probe y la recolección sin salir a internet.
 */
function fixtureTemplates(): SourceTemplate[] {
  const base = features.fixtures.baseUrl.replace(/\/+$/, '');

  return [
    {
      id: 'fixture-feed',
      label: 'Fixture: feed RSS (dev)',
      kind: SourceKind.RSS,
      description: 'Feed de prueba que sirve el contenedor del fixture.',
      params: { feedUrl: `${base}/feed.xml`, maxItems: 20 },
    },
    {
      id: 'fixture-trends',
      label: 'Fixture: página de tendencias (dev)',
      kind: SourceKind.PUBLIC_WEB,
      description: 'Página HTML de prueba con tarjetas `.trend-card` (sirve para ver el probe).',
      params: {
        listUrl: `${base}/trends.html`,
        recipe: {
          selectors: {
            item: '.trend-card',
            title: '.trend-card__title',
            url: '.trend-card__link',
            author: '.trend-card__author',
            metrics: '.trend-card__views',
            keywords: '.trend-card__tag',
            postedAt: '.trend-card__date',
          },
        },
      },
    },
  ];
}

export function sourceTemplates(): SourceTemplate[] {
  return features.fixtures.enabled
    ? [...BASE_TEMPLATES, ...fixtureTemplates()]
    : [...BASE_TEMPLATES];
}
