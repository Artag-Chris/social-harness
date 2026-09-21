import { describe, expect, it } from 'vitest';
import { absolutizeUrl, canonicalizeUrl, originOf } from './url.util';

/**
 * La canonicalización es la base del dedup: si dos enlaces del mismo contenido no
 * se convierten en la MISMA cadena, la señal entra dos veces y el análisis gasta IA
 * en repetir. Pero tampoco puede ser agresiva: borrar parámetros que identifican
 * contenido fusionaría cosas distintas.
 */
describe('canonicalizeUrl', () => {
  it('normaliza host, www, puerto por defecto, fragmento y barra final', () => {
    expect(canonicalizeUrl('https://WWW.Ejemplo.com:443/a/b/#seccion')).toBe('https://ejemplo.com/a/b');
    expect(canonicalizeUrl('http://ejemplo.com:80/x/')).toBe('http://ejemplo.com/x');
  });

  it('quita parámetros de tracking (que no cambian qué se está mirando)', () => {
    expect(canonicalizeUrl('https://ejemplo.com/post?utm_source=feed&utm_medium=rss&id=7')).toBe(
      'https://ejemplo.com/post?id=7',
    );
    expect(canonicalizeUrl('https://ejemplo.com/v?si=abc123')).toBe('https://ejemplo.com/v');
    expect(canonicalizeUrl('https://ejemplo.com/v?fbclid=xyz&v=42')).toBe('https://ejemplo.com/v?v=42');
  });

  it('CONSERVA los parámetros que identifican contenido', () => {
    // Esta es la lección de cv-harness: `jk`/`vjk` (Indeed) o un `id` de video
    // identifican la pieza. Sacarlos fusionaría avisos distintos.
    expect(canonicalizeUrl('https://ejemplo.com/watch?v=dQw4w9WgXcQ&list=PL1')).toBe(
      'https://ejemplo.com/watch?list=PL1&v=dQw4w9WgXcQ',
    );
  });

  it('ordena los parámetros para que el mismo contenido dé la misma huella', () => {
    expect(canonicalizeUrl('https://ejemplo.com/x?b=2&a=1')).toBe('https://ejemplo.com/x?a=1&b=2');
  });

  it('devuelve null para lo que no es una URL http(s)', () => {
    expect(canonicalizeUrl('no-es-url')).toBeNull();
    expect(canonicalizeUrl('ftp://ejemplo.com/x')).toBeNull();
  });

  it('la raíz conserva su barra', () => {
    expect(canonicalizeUrl('https://ejemplo.com')).toBe('https://ejemplo.com/');
    expect(canonicalizeUrl('https://ejemplo.com/')).toBe('https://ejemplo.com/');
  });

  it('es idempotente (canonicalizar lo canónico no cambia nada)', () => {
    const once = canonicalizeUrl('https://ejemplo.com/a?utm_source=x&id=1')!;
    expect(canonicalizeUrl(once)).toBe(once);
  });
});

describe('absolutizeUrl', () => {
  it('resuelve relativas contra la base', () => {
    expect(absolutizeUrl('/a/b', 'https://ejemplo.com/x/y')).toBe('https://ejemplo.com/a/b');
    expect(absolutizeUrl('c', 'https://ejemplo.com/a/')).toBe('https://ejemplo.com/a/c');
  });

  it('devuelve null si no hay nada que resolver', () => {
    expect(absolutizeUrl('', 'https://ejemplo.com')).toBeNull();
    expect(absolutizeUrl(null, 'https://ejemplo.com')).toBeNull();
  });
});

describe('originOf', () => {
  it('devuelve el origen o null', () => {
    expect(originOf('https://ejemplo.com/a/b')).toBe('https://ejemplo.com');
    expect(originOf('cualquier cosa')).toBeNull();
  });
});
