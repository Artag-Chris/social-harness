/**
 * Catálogo de redes y formatos — la ÚNICA fuente de verdad.
 *
 * Por qué es un catálogo y no un enum de la base: agregar una red nueva (LinkedIn)
 * o quitarla tiene que ser barato. En Postgres, un `ALTER TYPE ... ADD VALUE`
 * cuesta una migración en cada deploy y **borrar un valor de un enum es
 * imposible** sin recrear el tipo. Como los formatos y las redes cambian seguido
 * (Instagram/TikTok inventan formatos todos los años), acá la verdad vive en
 * código y en la base se guarda un texto validado contra este catálogo.
 *
 * Nada de lo que hay acá es "configuración del usuario": es la definición de la
 * plataforma. Lo que el usuario elige (qué redes tiene su perfil) vive en
 * `SocialAccount`.
 *
 * Para sumar una red: agregar su clave en `PLATFORM_KEYS`, su definición en
 * `PLATFORMS` y listo — la validación, el endpoint `GET /platforms` y la UI (que
 * se arma desde ese endpoint) se actualizan solos.
 */

/** Claves de las redes. En MAYÚSCULAS porque es lo que ya está guardado en la base. */
export const PLATFORM_KEYS = ['INSTAGRAM', 'TIKTOK', 'YOUTUBE', 'LINKEDIN'] as const;
export type PlatformKey = (typeof PLATFORM_KEYS)[number];

/** Formas de contenido, más allá de la red (para razonar sin mirar la plataforma). */
export type FormatKind =
  | 'short-video'
  | 'long-video'
  | 'carousel'
  | 'text-post'
  | 'story'
  | 'live'
  | 'article'
  | 'poll';

export const FORMAT_KEYS = [
  'REEL',
  'SHORT',
  'VIDEO',
  'CAROUSEL',
  'POST',
  'STORY',
  'LIVE',
  'ARTICLE',
  'POLL',
] as const;
export type FormatKey = (typeof FORMAT_KEYS)[number];

export interface FormatDefinition {
  label: string;
  kind: FormatKind;
  /** Si el formato ES video (el guion es el entregable, no el caption). */
  isVideo: boolean;
  /** Aclaración para el prompt de la IA y para la UI (cambia según la red). */
  notes?: string;
}

/**
 * Definición global de cada formato. La etiqueta es genérica a propósito; las
 * diferencias por red se explican en `notes` (p. ej. un carrusel es un documento
 * PDF en LinkedIn y una secuencia de imágenes en Instagram).
 */
export const FORMATS: Record<FormatKey, FormatDefinition> = {
  REEL: {
    label: 'Reel',
    kind: 'short-video',
    isVideo: true,
    notes: 'Video vertical corto. El primer segundo decide todo.',
  },
  SHORT: {
    label: 'Short',
    kind: 'short-video',
    isVideo: true,
    notes: 'Video vertical corto (TikTok / YouTube Shorts).',
  },
  VIDEO: {
    label: 'Video',
    kind: 'long-video',
    isVideo: true,
    notes: 'Video horizontal o largo, con desarrollo.',
  },
  CAROUSEL: {
    label: 'Carrusel',
    kind: 'carousel',
    isVideo: false,
    notes: 'Secuencia de piezas. En Instagram son imágenes; en LinkedIn, un documento PDF.',
  },
  POST: {
    label: 'Post',
    kind: 'text-post',
    isVideo: false,
    notes: 'Pieza simple: imagen suelta en Instagram, texto en LinkedIn, publicación de comunidad en YouTube.',
  },
  STORY: {
    label: 'Historia',
    kind: 'story',
    isVideo: false,
    notes: 'Efímera (24 h) y vertical. Sirve para sostener, no para captar.',
  },
  LIVE: {
    label: 'En vivo',
    kind: 'live',
    isVideo: true,
    notes: 'Transmisión. Requiere aviso previo para que rinda.',
  },
  ARTICLE: {
    label: 'Artículo',
    kind: 'article',
    isVideo: false,
    notes: 'Texto largo con URL propia (LinkedIn Articles). Aporta autoridad, no alcance.',
  },
  POLL: {
    label: 'Encuesta',
    kind: 'poll',
    isVideo: false,
    notes: 'Interacción barata: sirve para medir audiencia, no para crecer sola.',
  },
};

export interface PlatformDefinition {
  key: PlatformKey;
  label: string;
  /** Formatos que la red permite (el catálogo de arriba, filtrado). */
  formats: FormatKey[];
  /** Formatos que el coach sugiere por defecto al armar el calendario. */
  defaultFormats: FormatKey[];
  /** Cómo se consiguen señales de tendencia de esta red (ver ADR-001/004). */
  trendsStrategy: 'api' | 'public-web' | 'manual';
  /** API oficial de métricas propias, si existe (ver ADR-002). */
  officialMetricsApi: string | null;
  /** ¿Se puede automatizar el scraping? LinkedIn, no (ver ADR-001, decisión 4). */
  scrapingAllowed: boolean;
  /** Guía para el prompt: qué funciona en esta red. */
  contentHint: string;
  /** Heurística de horarios (orientativa: la UI y el prompt la usan como pista). */
  bestTimesHint: string;
  /** Cuántos hashtags tienen sentido. */
  hashtagsHint: string;
}

export const PLATFORMS: Record<PlatformKey, PlatformDefinition> = {
  INSTAGRAM: {
    key: 'INSTAGRAM',
    label: 'Instagram',
    formats: ['REEL', 'CAROUSEL', 'STORY', 'POST'],
    defaultFormats: ['REEL', 'CAROUSEL'],
    trendsStrategy: 'public-web',
    officialMetricsApi: 'Instagram Graph API (cuenta profesional)',
    scrapingAllowed: false,
    contentHint:
      'Reels cortos con hook en el primer segundo y texto en pantalla; carruseles que aportan algo guardable. El guardado y el compartido pesan más que el like.',
    bestTimesHint: 'Días de semana 11-13 h y 19-21 h; domingo por la noche suele rendir.',
    hashtagsHint: '3 a 5 hashtags específicos del tema (no genéricos).',
  },
  TIKTOK: {
    key: 'TIKTOK',
    label: 'TikTok',
    formats: ['SHORT', 'CAROUSEL', 'STORY'],
    defaultFormats: ['SHORT'],
    trendsStrategy: 'public-web',
    officialMetricsApi: 'TikTok for Developers (Display API)',
    scrapingAllowed: false,
    contentHint:
      'Video vertical nativo: sin intro, con la promesa en los primeros 2 segundos y ritmo alto. Lo que más pesa es la retención y el comentario.',
    bestTimesHint: '18-22 h es el pico; martes, jueves y domingo rinden mejor.',
    hashtagsHint: '2 a 4 hashtags, mezclando uno de nicho y uno de tema.',
  },
  YOUTUBE: {
    key: 'YOUTUBE',
    label: 'YouTube',
    formats: ['SHORT', 'VIDEO', 'LIVE', 'POST'],
    defaultFormats: ['SHORT', 'VIDEO'],
    trendsStrategy: 'api',
    officialMetricsApi: 'YouTube Analytics API + Data API',
    scrapingAllowed: false,
    contentHint:
      'Shorts para captar y videos largos para retener y buscar: el título y la miniatura pesan tanto como el contenido. La búsqueda sigue trayendo tráfico meses después.',
    bestTimesHint: 'Viernes a domingo 10-13 h para largo; Shorts, cualquier día 19-22 h.',
    hashtagsHint: 'Casi ninguno: 2 o 3 en Shorts, ninguno en videos largos.',
  },
  LINKEDIN: {
    key: 'LINKEDIN',
    label: 'LinkedIn',
    formats: ['POST', 'CAROUSEL', 'VIDEO', 'ARTICLE', 'POLL'],
    defaultFormats: ['POST', 'CAROUSEL'],
    trendsStrategy: 'manual',
    officialMetricsApi: 'Marketing API (solo páginas de empresa; no hay insights de perfiles personales)',
    scrapingAllowed: false,
    contentHint:
      'Texto con una idea por publicación, primera línea como título (es lo único que se ve antes del "ver más") y cierre con pregunta. Lo que funciona es la experiencia concreta y el criterio, no el anuncio. Los documentos PDF (carrusel) son el formato que más alcance da hoy.',
    bestTimesHint: 'Martes a jueves 7-9 h y 12-13 h (horario laboral); el fin de semana casi no rinde.',
    hashtagsHint: '3 a 5, al final, específicos del sector. Más de 5 se lee como spam.',
  },
};

/** Claves de todas las redes, en orden de catálogo. */
export function platformKeys(): PlatformKey[] {
  return [...PLATFORM_KEYS];
}

export function isPlatformKey(value: string): value is PlatformKey {
  return (PLATFORM_KEYS as readonly string[]).includes(value);
}

export function isFormatKey(value: string): value is FormatKey {
  return (FORMAT_KEYS as readonly string[]).includes(value as FormatKey);
}

/** Definición de una red (lanza si la clave no existe: es un error de programa, no de datos). */
export function platform(key: PlatformKey): PlatformDefinition {
  const found = PLATFORMS[key];
  if (!found) throw new Error(`Red desconocida en el catálogo: ${String(key)}`);
  return found;
}

export function format(key: FormatKey): FormatDefinition {
  const found = FORMATS[key];
  if (!found) throw new Error(`Formato desconocido en el catálogo: ${String(key)}`);
  return found;
}

export function formatsFor(key: PlatformKey): FormatKey[] {
  return [...platform(key).formats];
}

/** ¿La red permite ese formato? Es la validación que reemplaza al enum de la base. */
export function formatBelongsToPlatform(platformKey: PlatformKey, formatKey: FormatKey): boolean {
  return platform(platformKey).formats.includes(formatKey);
}

/** Etiqueta legible de un formato (para la UI y los resúmenes). */
export function formatLabel(formatKey: FormatKey): string {
  return isFormatKey(formatKey) ? FORMATS[formatKey].label : formatKey;
}

/** Etiqueta legible de una red. */
export function platformLabel(platformKey: string): string {
  return isPlatformKey(platformKey) ? PLATFORMS[platformKey].label : platformKey;
}

/**
 * Catálogo serializable, para `GET /platforms`: así la UI arma los selectores
 * desde acá y **agregar una red no obliga a tocar el front**.
 */
export function platformsCatalog(): Array<
  PlatformDefinition & { formatDetails: Array<FormatDefinition & { key: FormatKey }> }
> {
  return PLATFORM_KEYS.map((key) => {
    const definition = PLATFORMS[key];
    return {
      ...definition,
      formats: [...definition.formats],
      defaultFormats: [...definition.defaultFormats],
      formatDetails: definition.formats.map((formatKey) => ({
        key: formatKey,
        ...FORMATS[formatKey],
      })),
    };
  });
}
