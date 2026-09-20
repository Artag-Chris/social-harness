import type { LlmUsage } from './llm-provider.port';

/**
 * Precios de lista por 1M de tokens (USD), para poder informar el gasto real.
 *
 * ⚠️ Esto es SOLO telemetría (lo que se muestra en `GET /usage`), no facturación:
 * los precios cambian y conviene verificarlos contra la página del proveedor.
 * Si el modelo no está en la tabla, el costo queda en 0 y se avisa UNA vez en el
 * log — no se inventa un número. Para el modelo propio, se puede fijar el precio
 * por `.env` sin tocar código (`LLM_PRICE_INPUT_PER_1M` / `LLM_PRICE_OUTPUT_PER_1M`).
 */
export interface ModelPrice {
  /** USD por 1M de tokens de entrada. */
  inputPer1M: number;
  /** USD por 1M de tokens de salida. */
  outputPer1M: number;
  /** USD por 1M de tokens de entrada servidos desde caché. */
  cachedInputPer1M?: number;
}

export const MODEL_PRICING: Record<string, ModelPrice> = {
  'deepseek-chat': { inputPer1M: 0.27, outputPer1M: 1.1, cachedInputPer1M: 0.07 },
  'deepseek-reasoner': { inputPer1M: 0.55, outputPer1M: 2.19, cachedInputPer1M: 0.14 },
  'llama-3.3-70b-versatile': { inputPer1M: 0.59, outputPer1M: 0.79 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
};

export interface PriceOverride {
  inputPer1M?: number;
  outputPer1M?: number;
}

let warnedAboutModel: string | null = null;

/** Solo para tests: permite volver a ver el aviso de modelo desconocido. */
export function resetPricingWarning(): void {
  warnedAboutModel = null;
}

export function calculateCost(
  model: string,
  usage: LlmUsage,
  override: PriceOverride = {},
): number {
  const price = MODEL_PRICING[model];

  if (!price && override.inputPer1M === undefined && override.outputPer1M === undefined) {
    if (warnedAboutModel !== model) {
      warnedAboutModel = model;
      process.stderr.write(
        `${JSON.stringify({
          level: 'warn',
          context: 'LlmPricing',
          msg: `Sin precio para el modelo "${model}": el costo se registrará en 0.`,
          fix: 'Agregalo en pricing.ts o poné LLM_PRICE_INPUT_PER_1M / LLM_PRICE_OUTPUT_PER_1M en el .env.',
          time: new Date().toISOString(),
        })}\n`,
      );
    }
    return 0;
  }

  const inputPer1M = override.inputPer1M ?? price?.inputPer1M ?? 0;
  const outputPer1M = override.outputPer1M ?? price?.outputPer1M ?? 0;
  const cachedPer1M = price?.cachedInputPer1M ?? inputPer1M;

  // Los tokens cacheados se cobran más barato: se descuentan del total de entrada
  // para no contarlos dos veces.
  const cached = Math.min(usage.cachedInputTokens, usage.inputTokens);
  const freshInput = Math.max(usage.inputTokens - cached, 0);

  const cost =
    (freshInput / 1_000_000) * inputPer1M +
    (cached / 1_000_000) * cachedPer1M +
    (usage.outputTokens / 1_000_000) * outputPer1M;

  // Redondeo a 6 decimales: por debajo de eso es ruido de coma flotante.
  return Math.round(cost * 1_000_000) / 1_000_000;
}
