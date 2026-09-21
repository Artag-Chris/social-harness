import { describe, expect, it } from 'vitest';
import { buildDupKey, normalize } from './dup-key';

/**
 * La clave de contenido decide cuándo una señal se marca como duplicada. Es
 * conservadora a propósito: el mismo tema en dos medios distintos es una señal más
 * fuerte, no algo para ocultar.
 */
describe('buildDupKey', () => {
  it('agrupa el mismo título del mismo autor aunque cambien mayúsculas y acentos', () => {
    const a = buildDupKey('Cómo estructurar un reel que retenga 8 segundos', 'Equipo');
    const b = buildDupKey('como ESTRUCTURAR un reel que retenga 8 segundos!', 'equipo');

    expect(a).not.toBeNull();
    expect(a).toBe(b);
  });

  it('NO agrupa el mismo título publicado por otro autor', () => {
    const delMedio = buildDupKey('Las marcas personales que más crecieron este mes', 'Redacción');
    const delBlog = buildDupKey('Las marcas personales que más crecieron este mes', 'Equipo');

    expect(delMedio).not.toBe(delBlog);
  });

  it('devuelve null sin autor (un título suelto agruparía cosas sin relación)', () => {
    expect(buildDupKey('Un título suficientemente largo como para pasar', null)).toBeNull();
  });

  it('devuelve null con títulos demasiado cortos', () => {
    expect(buildDupKey('Novedades', 'Equipo')).toBeNull();
  });

  it('devuelve null si falta el título', () => {
    expect(buildDupKey('', 'Equipo')).toBeNull();
    expect(buildDupKey(undefined, 'Equipo')).toBeNull();
  });
});

describe('normalize', () => {
  it('saca acentos, puntuación y espacios de más', () => {
    expect(normalize('  ¡Hábitos   Atómicos!  ')).toBe('habitos atomicos');
  });

  it('con valores raros devuelve cadena vacía', () => {
    expect(normalize(null)).toBe('');
    expect(normalize(undefined)).toBe('');
  });
});
