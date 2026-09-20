import { afterEach, describe, expect, it, vi } from 'vitest';
import { calculateCost, MODEL_PRICING, resetPricingWarning } from './pricing';

/**
 * El costo es telemetría (`GET /usage`), pero tiene que ser verificable: si el
 * número está mal, la conversación sobre gasto se vuelve a ojo.
 */
describe('calculateCost', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetPricingWarning();
  });

  it('cobra entrada y salida con el precio del modelo', () => {
    const cost = calculateCost('deepseek-chat', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cachedInputTokens: 0,
    });

    // 0.27 de entrada + 1.10 de salida
    expect(cost).toBe(1.37);
  });

  it('cobra más barato los tokens de entrada que vinieron de caché', () => {
    const cost = calculateCost('deepseek-chat', {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cachedInputTokens: 1_000_000,
    });

    expect(cost).toBe(0.07);
  });

  it('no cuenta dos veces los tokens cacheados (se descuentan de la entrada)', () => {
    const cost = calculateCost('deepseek-chat', {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cachedInputTokens: 500_000,
    });

    // 500k frescos a 0.27 + 500k cacheados a 0.07
    expect(cost).toBe(0.17);
  });

  it('con un modelo desconocido deja el costo en 0 y avisa UNA sola vez', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const usage = { inputTokens: 1000, outputTokens: 1000, cachedInputTokens: 0 };

    expect(calculateCost('modelo-inexistente', usage)).toBe(0);
    expect(calculateCost('modelo-inexistente', usage)).toBe(0);

    expect(stderr).toHaveBeenCalledTimes(1);
    expect(String(stderr.mock.calls[0]?.[0])).toContain('modelo-inexistente');
  });

  it('el precio del .env manda sobre la tabla (modelo propio sin tocar código)', () => {
    const cost = calculateCost(
      'modelo-propio',
      { inputTokens: 1_000_000, outputTokens: 1_000_000, cachedInputTokens: 0 },
      { inputPer1M: 1, outputPer1M: 2 },
    );

    expect(cost).toBe(3);
  });

  it('los cacheados nunca superan la entrada (no da costo negativo)', () => {
    const cost = calculateCost('deepseek-chat', {
      inputTokens: 1000,
      outputTokens: 0,
      cachedInputTokens: 999_999,
    });

    expect(cost).toBeGreaterThanOrEqual(0);
    expect(cost).toBeCloseTo(0.00007, 6);
  });

  it('la tabla tiene los modelos que el proyecto usa hoy', () => {
    expect(Object.keys(MODEL_PRICING)).toContain('deepseek-chat');
    expect(Object.keys(MODEL_PRICING)).toContain('llama-3.3-70b-versatile');
  });
});
