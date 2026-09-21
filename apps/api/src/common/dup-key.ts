/**
 * Clave de contenido para detectar la MISMA pieza publicada en otro lugar (mismo
 * título, otra URL).
 *
 * Deliberadamente conservadora: incluye el autor, así que solo agrupa cuando el
 * título y el autor coinciden. ¿Por qué? Porque el mismo tema contado por dos
 * medios distintos **no es un duplicado: es una señal más fuerte**. Lo que sí
 * conviene ocultar es el repost literal del mismo autor en otro feed.
 *
 * Devuelve `null` si falta el autor o el título es demasiado corto: con un título
 * suelto ("Novedades") se agruparían cosas sin relación.
 */

const MIN_TITLE_LENGTH = 20;

export function buildDupKey(title: string | null | undefined, author: string | null | undefined): string | null {
  const cleanTitle = normalize(title);
  const cleanAuthor = normalize(author);

  if (!cleanTitle || !cleanAuthor) return null;
  if (cleanTitle.length < MIN_TITLE_LENGTH) return null;

  return `${cleanTitle}|${cleanAuthor}`;
}

/** Minúsculas, sin acentos ni puntuación, espacios colapsados. */
export function normalize(value: string | null | undefined): string {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
