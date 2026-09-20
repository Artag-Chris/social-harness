import { describe, expect, it } from 'vitest';
import { resolveIntervalHours, DEFAULT_INTERVAL_HOURS } from './interval-hours';

/**
 * La precedencia de cadencia es fácil de romper al agregar features (tres
 * niveles pueden definirla), así que se fija acá.
 */
describe('resolveIntervalHours', () => {
  it('gana la selección perfil↔fuente (lo más específico)', () => {
    expect(
      resolveIntervalHours({ selectionHours: 3, profileHours: 6, sourceHours: 12 }),
    ).toBe(3);
  });

  it('sin selección, gana el perfil', () => {
    expect(resolveIntervalHours({ profileHours: 6, sourceHours: 12 })).toBe(6);
  });

  it('sin perfil, gana la fuente', () => {
    expect(resolveIntervalHours({ sourceHours: 12 })).toBe(12);
  });

  it('sin nada definido, usa el fallback configurado', () => {
    expect(resolveIntervalHours({}, 48)).toBe(48);
  });

  it('sin fallback válido, cae al default del sistema', () => {
    expect(resolveIntervalHours({})).toBe(DEFAULT_INTERVAL_HOURS);
    expect(resolveIntervalHours({}, 0)).toBe(DEFAULT_INTERVAL_HOURS);
  });

  it('ignora valores inválidos y sigue bajando de nivel', () => {
    expect(
      resolveIntervalHours({ selectionHours: 0, profileHours: -5, sourceHours: 8 }),
    ).toBe(8);
    expect(
      resolveIntervalHours({ selectionHours: Number.NaN, profileHours: 2.5 }),
    ).toBe(DEFAULT_INTERVAL_HOURS);
  });

  it('trata null/undefined como "no definido"', () => {
    expect(resolveIntervalHours({ selectionHours: null, profileHours: undefined, sourceHours: 9 })).toBe(9);
  });
});
