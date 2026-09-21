import { createHash } from 'node:crypto';

/**
 * Huella de una señal: es la clave de idempotencia del pipeline.
 *
 * Se calcula sobre la URL **canónica**, así que reingestar el mismo enlace con
 * otros parámetros de tracking no crea una fila nueva. Para lo que no tiene URL
 * (una inspiración pegada a mano) se usa el texto.
 */
export function fingerprintOf(canonicalUrl: string): string {
  return sha256Hex(canonicalUrl);
}

export function fingerprintOfText(text: string): string {
  return sha256Hex(`manual:${text.trim().replace(/\s+/g, ' ').toLowerCase()}`);
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
