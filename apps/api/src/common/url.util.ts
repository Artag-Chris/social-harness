/**
 * Canonicalización de URLs: la base del dedup.
 *
 * Dos enlaces que apuntan al mismo contenido (con `?utm_source=…`, sin `www`, con
 * barra final, con un fragmento) tienen que convertirse en la MISMA cadena, si no
 * la misma señal entra varias veces y el análisis gasta IA en repetir.
 *
 * Cuidado con la lista de parámetros que se borran: es CORTA a propósito. En
 * cv-harness la lección fue que `jk`/`vjk`/`source`/`ref` identifican el aviso y
 * sacarlos fusionaría cosas distintas. Acá solo se quitan los de tracking/sesión,
 * que no cambian QUÉ se está mirando.
 */

/** Parámetros de tracking: no identifican contenido, solo de dónde vino el click. */
const TRACKING_PARAMS = new Set([
  'gclid',
  'fbclid',
  'msclkid',
  'twclid',
  'ttclid',
  'igshid',
  'igsh',
  'li_fat_id',
  'mc_cid',
  'mc_eid',
  '_hsenc',
  '_hsmi',
  'vero_id',
  'wickedid',
  'yclid',
  // Compartir/atribución de redes
  'si',
  'feature',
  'referrer',
  'ref_src',
  'ref_url',
  's',
  't',
]);

const TRACKING_PREFIXES = ['utm_', 'pk_', 'mtm_', 'hsa_'];

export function canonicalizeUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  url.hash = '';
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  // Los puertos por defecto no cambian el recurso.
  if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) {
    url.port = '';
  }

  const keep: Array<[string, string]> = [];
  for (const [key, value] of url.searchParams.entries()) {
    const lower = key.toLowerCase();
    if (TRACKING_PARAMS.has(lower)) continue;
    if (TRACKING_PREFIXES.some((prefix) => lower.startsWith(prefix))) continue;
    keep.push([key, value]);
  }
  keep.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  url.search = '';
  for (const [key, value] of keep) url.searchParams.append(key, value);

  // La barra final no cambia el recurso (salvo que sea la raíz).
  let path = url.pathname.replace(/\/+$/, '');
  if (path.length === 0) path = '/';
  url.pathname = path;

  return url.toString();
}

/** Origen (`https://host`) de una URL, o null. */
export function originOf(raw: string): string | null {
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/**
 * Convierte una URL relativa en absoluta contra una base.
 * Devuelve null si no se puede resolver (es preferible descartar el item a
 * guardar una ruta rota).
 */
export function absolutizeUrl(href: string | null | undefined, base: string): string | null {
  if (!href || href.trim().length === 0) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}
