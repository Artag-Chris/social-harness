import type { Env } from '../../../config/env';
import { OpenAiCompatibleProvider } from '../openai-compatible/openai-compatible.provider';
import type { LlmProviderPort } from '../llm-provider.port';

/**
 * Adaptador de Groq — el fallback cuando el principal falla.
 *
 * También es OpenAI-compatible, y ojo con un detalle que ya está resuelto en la
 * base: Groq valida los *tool calls* de forma estricta (por eso en `atiende`
 * corren en modo prompt-completion). Acá no usamos tools —el puerto expone
 * `chat`/`json`— así que no aplica.
 */
export const GROQ = {
  name: 'groq',
  defaultBaseUrl: 'https://api.groq.com/openai/v1',
} as const;

export function createGroqProvider(config: Env): LlmProviderPort {
  return new OpenAiCompatibleProvider({
    provider: GROQ.name,
    baseUrl: config.GROQ_BASE_URL || GROQ.defaultBaseUrl,
    apiKey: config.GROQ_API_KEY,
    model: config.GROQ_MODEL,
    timeoutMs: config.LLM_TIMEOUT_MS,
    maxRetries: config.LLM_MAX_RETRIES,
    defaultMaxTokens: config.LLM_MAX_TOKENS,
  });
}
