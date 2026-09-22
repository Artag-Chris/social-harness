import { describe, expect, it } from 'vitest';
import { normalizeToDay, parseDate, parseMetricsCsv, parseNumber } from './metrics.csv';

/**
 * El parser del CSV es la puerta de entrada de los datos que después sostienen el
 * reporte de rendimiento: si lee mal un número o inventa una fecha, el reporte miente.
 * Por eso lo que se prueba es la tolerancia y, sobre todo, lo que NO debe hacer.
 */
describe('parseMetricsCsv', () => {
  it('lee un CSV típico en español con encabezados y filas', () => {
    const { rows, warnings } = parseMetricsCsv(
      ['fecha,seguidores,alcance,engagement,likes', '2026-09-01,1000,45000,4,320', '2026-09-02,1040,52000,4.5,410'].join('\n'),
    );

    expect(warnings).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ followers: 1000, reach: 45000, engagementRate: 4, likes: 320 });
    expect(rows[1]?.capturedAt.toISOString()).toBe('2026-09-02T00:00:00.000Z');
  });

  it('acepta encabezados en inglés y separador punto y coma', () => {
    const { rows } = parseMetricsCsv(['date;followers;impressions', '01/09/2026;1.200;30.000'].join('\n'));

    expect(rows[0]).toMatchObject({ followers: 1200, impressions: 30000 });
  });

  it('entiende los números como los escribe una planilla (miles, comas, %)', () => {
    const { rows } = parseMetricsCsv('fecha,seguidores,engagement\n2026-09-01,"1,200","4,5%"\n');

    expect(rows[0]).toMatchObject({ followers: 1200, engagementRate: 4.5 });
  });

  it('descarta las filas sin fecha válida y lo avisa (no inventa el día)', () => {
    const { rows, warnings } = parseMetricsCsv(
      ['fecha,seguidores', '2026-09-01,1000', 'no es fecha,2000', ',3000'].join('\n'),
    );

    expect(rows).toHaveLength(1);
    expect(warnings.join(' ')).toContain('2 fila(s) sin fecha válida');
  });

  it('sin columna de fecha no devuelve nada y explica por qué', () => {
    const { rows, warnings } = parseMetricsCsv('seguidores,alcance\n1000,45000\n');

    expect(rows).toEqual([]);
    expect(warnings[0]).toContain('necesita una columna de fecha');
  });

  it('con columnas de métricas desconocidas avisa (pero no falla)', () => {
    const { rows, warnings } = parseMetricsCsv('fecha,cosa\n2026-09-01,5\n');

    expect(rows).toHaveLength(1);
    expect(warnings.join(' ')).toContain('No reconocí ninguna columna de métricas');
  });

  it('un CSV vacío se reporta, no se rompe', () => {
    expect(parseMetricsCsv('   ').warnings[0]).toContain('vacío');
  });

  it('normaliza la fecha al día (el snapshot es por día)', () => {
    const { rows } = parseMetricsCsv('fecha,seguidores\n2026-09-01T18:30:00Z,1000\n');

    expect(rows[0]?.capturedAt.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });
});

describe('parseDate', () => {
  it('acepta dd/mm/yyyy, yyyy-mm-dd e ISO', () => {
    expect(parseDate('05/09/2026')?.toISOString()).toBe('2026-09-05T00:00:00.000Z');
    expect(parseDate('2026-09-05')?.toISOString()).toBe('2026-09-05T00:00:00.000Z');
    expect(parseDate('2026-09-05T10:00:00Z')?.toISOString()).toBe('2026-09-05T00:00:00.000Z');
  });

  it('devuelve null con basura', () => {
    expect(parseDate('cualquier cosa')).toBeNull();
    expect(parseDate('')).toBeNull();
  });
});

describe('parseNumber', () => {
  it('interpreta miles y decimales como se escriben en LatAm y en EEUU', () => {
    expect(parseNumber('1.200')).toBe(1200);
    expect(parseNumber('1,200')).toBe(1200);
    expect(parseNumber('4,5')).toBe(4.5);
    expect(parseNumber('4.5')).toBe(4.5);
    expect(parseNumber('12%')).toBe(12);
  });

  it('devuelve undefined si no hay número', () => {
    expect(parseNumber('')).toBeUndefined();
    expect(parseNumber('sin dato')).toBeUndefined();
  });
});

describe('normalizeToDay', () => {
  it('deja la medianoche UTC (clave del upsert por día)', () => {
    expect(normalizeToDay(new Date('2026-09-01T23:59:59Z')).toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });
});
