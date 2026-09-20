import type { Env } from '../../../config/env';
import { OpenAiCompatibleProvider } from '../openai-compatible/openai-compatible.provider';
import type { LlmProviderPort } from '../llm-provider.port';

/**
 * Adaptador de DeepSeek — el proveedor que ya usan `atiende` y `cv-harness`,
 * así que es el principal acá también (misma llave, mismo modelo).
 *
 * DeepSeek expone la API de Chat Completions compatible con OpenAI, así que toda
 * la mecánica vive en `OpenAiCompatibleProvider`. Este archivo es solo su preset:
 * si algún día DeepSeek necesita algo distinto (un header, un modo de
 * razonamiento), se resuelve acá sin tocar a los otros proveedores.
 */
export const DEEPSEEK = {
  name: 'deepseek',
  defaultBaseUrl: 'https://api.deepseek.com',
} as const;

export function createDeepSeekProvider(config: Env): LlmProviderPort {
  const price = {
    inputPer1M: config.LLM_PRICE_INPUT_PER_1M,
    outputPer1M: config.LLM_PRICE_OUTPUT_PER_1M,
  };

  return new OpenAiCompatibleProvider({
    provider: DEEPSEEK.name,
    baseUrl: config.DEEPSEEK_BASE_URL || DEEPSEEK.defaultBaseUrl,
    apiKey: config.DEEPSEEK_API_KEY,
    model: config.DEEPSEEK_MODEL,
    timeoutMs: config.LLM_TIMEOUT_MS,
    maxRetries: config.LLM_MAX_RETRIES,
    defaultMaxTokens: config.LLM_MAX_TOKENS,
    priceOverride: price,
  });
}
