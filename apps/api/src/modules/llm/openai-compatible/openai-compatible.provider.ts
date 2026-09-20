import { LlmHttpError, LlmInvalidJsonError } from '../llm.errors';
import { calculateCost, type PriceOverride } from '../pricing';
import type {
  LlmChatRequest,
  LlmJsonRequest,
  LlmJsonResult,
  LlmProviderPort,
  LlmResult,
  LlmUsage,
} from '../llm-provider.port';

/**
 * Base compartida para proveedores OpenAI-compatible (DeepSeek, Groq, y
 * mañana Kimi/Ollama/OpenRouter: todos hablan el mismo dialecto).
 *
 * Acá vive TODO lo que no debería repetirse por proveedor: armado del body,
 * timeout, reintentos con backoff, modo JSON, parseo de usage y validación con
 * Zod. Un adaptador nuevo son ~15 líneas (su preset + su factory).
 *
 * Lo que un proveedor puede cambiar sin tocar esto: baseUrl, modelo, llaves,
 * precios y (si hiciera falta) un adaptador propio que no herede de acá —el
 * puerto es lo que el pipeline conoce, no esta clase.
 */

export interface OpenAiCompatibleConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
  defaultMaxTokens: number;
  priceOverride?: PriceOverride;
  /** Espera base del backoff. Configurable para que los tests no esperen segundos. */
  retryBaseDelayMs?: number;
}

/** Espera base del backoff (se duplica en cada reintento). */
const RETRY_BASE_DELAY_MS = 1500;

/** Motivos por los que un proveedor rechaza el modo JSON: se reintenta sin él. */
const JSON_MODE_REJECTED = /response_format|json_object|json mode|unsupported.*json/i;

export class OpenAiCompatibleProvider implements LlmProviderPort {
  readonly isMock = false;

  constructor(private readonly config: OpenAiCompatibleConfig) {}

  get name(): string {
    return this.config.provider;
  }

  get model(): string {
    return this.config.model;
  }

  async chat(request: LlmChatRequest): Promise<LlmResult> {
    const startedAt = Date.now();
    let jsonMode = request.json === true;
    let jsonFallbackUsed = false;
    let retries = 0;

    for (;;) {
      try {
        const body = await this.request(
          this.buildBody(request, jsonMode),
          request.signal,
        );
        return this.parseResult(body, startedAt);
      } catch (error) {
        const httpError =
          error instanceof LlmHttpError
            ? error
            : new LlmHttpError(this.name, 0, errorMessage(error));

        // El proveedor no acepta modo JSON: se reintenta una vez SIN él (el
        // parseo tolerante de `json()` igual encuentra el objeto). Esto es lo que
        // permite cambiar de modelo/proveedor sin tocar código.
        if (
          jsonMode &&
          !jsonFallbackUsed &&
          (httpError.status === 400 || httpError.status === 422) &&
          JSON_MODE_REJECTED.test(httpError.message)
        ) {
          jsonMode = false;
          jsonFallbackUsed = true;
          continue;
        }

        if (httpError.isRetryable && retries < this.config.maxRetries) {
          retries += 1;
          const baseDelay = this.config.retryBaseDelayMs ?? RETRY_BASE_DELAY_MS;
          await delay(baseDelay * 2 ** (retries - 1));
          continue;
        }

        throw httpError;
      }
    }
  }

  async json<T>(request: LlmJsonRequest<T>): Promise<LlmJsonResult<T> | null> {
    const result = await this.chat({
      system: request.system,
      messages: [{ role: 'user', content: buildJsonInstruction(request) }],
      json: true,
      maxTokens: request.maxTokens,
      temperature: request.temperature,
      signal: request.signal,
    });

    const parsed = parseJsonLoosely(result.text);
    if (!parsed.ok) {
      throw new LlmInvalidJsonError(
        this.name,
        `La respuesta de "${request.task}" no es JSON válido. Recibido: ${truncate(result.text, 300)}`,
      );
    }

    const validated = request.schema.safeParse(parsed.value);
    if (!validated.success) {
      const issues = validated.error.issues
        .map((issue) => `${issue.path.join('.') || '(raíz)'}: ${issue.message}`)
        .join('; ');
      throw new LlmInvalidJsonError(
        this.name,
        `La respuesta de "${request.task}" no cumple el contrato → ${issues}`,
      );
    }

    return { data: validated.data, meta: result };
  }

  /**
   * Chequeo de disponibilidad (script `npm run llm:check`).
   * Deliberadamente NO se llama desde `/health`: sería una request externa cada
   * 30 s por el healthcheck del contenedor.
   */
  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private buildBody(request: LlmChatRequest, jsonMode: boolean): Record<string, unknown> {
    return {
      model: this.config.model,
      messages: [{ role: 'system', content: request.system }, ...request.messages],
      max_tokens: request.maxTokens ?? this.config.defaultMaxTokens,
      temperature: request.temperature,
      stream: false,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    };
  }

  private async request(body: unknown, callerSignal?: AbortSignal): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const forwardAbort = (): void => controller.abort();
    callerSignal?.addEventListener('abort', forwardAbort, { once: true });

    try {
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const text = await response.text();

      if (!response.ok) {
        throw new LlmHttpError(
          this.name,
          response.status,
          extractProviderMessage(text, response.status),
        );
      }

      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new LlmHttpError(this.name, response.status, 'respuesta no parseable como JSON');
      }
    } catch (error) {
      if (error instanceof LlmHttpError) throw error;
      if (isAbortError(error)) {
        throw new LlmHttpError(
          this.name,
          0,
          `tiempo agotado (${this.config.timeoutMs} ms) o petición cancelada`,
        );
      }
      throw new LlmHttpError(
        this.name,
        0,
        `no se pudo conectar con ${this.config.baseUrl}: ${errorMessage(error)}`,
      );
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', forwardAbort);
    }
  }

  private parseResult(body: unknown, startedAt: number): LlmResult {
    const payload = body as {
      model?: string;
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
        prompt_cache_hit_tokens?: number;
      };
    };

    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new LlmHttpError(this.name, 200, 'el proveedor devolvió una respuesta sin contenido');
    }

    const model = payload.model ?? this.config.model;
    const usage: LlmUsage = {
      inputTokens: payload.usage?.prompt_tokens ?? 0,
      outputTokens: payload.usage?.completion_tokens ?? 0,
      // OpenAI/DeepSeek lo mandan en prompt_tokens_details.cached_tokens;
      // DeepSeek además expone prompt_cache_hit_tokens.
      cachedInputTokens:
        payload.usage?.prompt_tokens_details?.cached_tokens ??
        payload.usage?.prompt_cache_hit_tokens ??
        0,
    };

    return {
      text: content,
      provider: this.name,
      model,
      usage,
      costUsd: calculateCost(model, usage, this.config.priceOverride),
      latencyMs: Date.now() - startedAt,
    };
  }
}

/**
 * El proveedor puede envolver el objeto en un fence de markdown o en una frase.
 * Se intenta: texto tal cual → sin fence → desde el primer `{` hasta el último.
 */
export function parseJsonLoosely(raw: string): { ok: true; value: unknown } | { ok: false } {
  const candidates: string[] = [];

  const trimmed = raw.trim();
  candidates.push(trimmed);
  candidates.push(stripCodeFence(trimmed));

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    if (candidate.length === 0) continue;
    try {
      return { ok: true, value: JSON.parse(candidate) as unknown };
    } catch {
      // se prueba el siguiente candidato
    }
  }
  return { ok: false };
}

export function stripCodeFence(raw: string): string {
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(raw.trim());
  return fence?.[1]?.trim() ?? raw;
}

/**
 * Saca un motivo legible del cuerpo de error del proveedor (que a veces es HTML).
 * Sin esto, el log diría solo "HTTP 400" y habría que adivinar la causa.
 */
export function extractProviderMessage(rawBody: string, status: number): string {
  const fallback = `HTTP ${status} sin detalle`;
  if (!rawBody) return fallback;

  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    const error = parsed.error as Record<string, unknown> | string | undefined;
    const candidate =
      (typeof error === 'object' && error !== null ? error.message : error) ??
      parsed.message ??
      parsed.detail ??
      parsed.error_description;
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return truncate(cleanup(candidate), 300);
    }
  } catch {
    // el cuerpo no era JSON: se usa como texto plano
  }

  const plain = cleanup(rawBody);
  return plain.length > 0 ? truncate(plain, 300) : fallback;
}

/** Instrucción de JSON: el contrato va explícito y la palabra "json" aparece (DeepSeek la exige en modo JSON). */
export function buildJsonInstruction<T>(request: LlmJsonRequest<T>): string {
  const contract = request.hint
    ? `\n\nContrato de la respuesta (respetalo exactamente):\n${request.hint}`
    : '';
  return `${request.user}${contract}\n\nRespondé SOLO con un objeto json válido, sin texto adicional ni markdown.`;
}

function cleanup(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
