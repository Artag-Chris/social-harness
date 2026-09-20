import type { Env } from '../../../config/env';
import { EmbeddingError, type EmbeddingProviderPort } from '../embedding-provider.port';

/**
 * Adaptador de embeddings de OpenAI (`text-embedding-3-small`), el mismo que usa
 * `atiende` para su base de conocimiento y `cv-harness` para su match semántico:
 * misma cuenta y misma dimensión (1536) que espera la columna `vector(1536)`.
 *
 * Los textos se mandan en lotes (`EMBEDDING_BATCH_SIZE`) porque la API tiene un
 * tope por request y porque un lote grande en una sola llamada es más barato en
 * tiempo que N llamadas.
 */
export const OPENAI_EMBEDDINGS = {
  name: 'openai',
  defaultBaseUrl: 'https://api.openai.com/v1',
} as const;

export class OpenAiEmbeddingsProvider implements EmbeddingProviderPort {
  readonly isMock = false;

  constructor(private readonly config: Env) {}

  get name(): string {
    return OPENAI_EMBEDDINGS.name;
  }

  get model(): string {
    return this.config.EMBEDDING_MODEL;
  }

  get dimensions(): number {
    return this.config.EMBEDDING_DIMENSIONS;
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    if (texts.length === 0) return [];

    const batchSize = this.config.EMBEDDING_BATCH_SIZE;
    const vectors: number[][] = [];

    for (let start = 0; start < texts.length; start += batchSize) {
      const batch = texts.slice(start, start + batchSize);
      vectors.push(...(await this.embedBatch(batch, signal)));
    }

    return vectors;
  }

  private async embedBatch(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    const baseUrl = this.config.OPENAI_BASE_URL || OPENAI_EMBEDDINGS.defaultBaseUrl;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.EMBEDDING_TIMEOUT_MS);
    const forwardAbort = (): void => controller.abort();
    signal?.addEventListener('abort', forwardAbort, { once: true });

    try {
      const response = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({ model: this.model, input: texts }),
        signal: controller.signal,
      });

      const raw = await response.text();
      if (!response.ok) {
        throw new EmbeddingError(this.name, response.status, describeBody(raw, response.status));
      }

      const payload = JSON.parse(raw) as {
        data?: Array<{ embedding?: number[]; index?: number }>;
      };
      const rows = [...(payload.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

      if (rows.length !== texts.length) {
        throw new EmbeddingError(
          this.name,
          200,
          `se pidieron ${texts.length} vectores y llegaron ${rows.length}`,
        );
      }

      return rows.map((row) => this.assertDimensions(row.embedding));
    } catch (error) {
      if (error instanceof EmbeddingError) throw error;
      if (isAbortError(error)) {
        throw new EmbeddingError(
          this.name,
          0,
          `tiempo agotado (${this.config.EMBEDDING_TIMEOUT_MS} ms) o petición cancelada`,
        );
      }
      throw new EmbeddingError(this.name, 0, `no se pudo conectar con ${baseUrl}: ${messageOf(error)}`);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', forwardAbort);
    }
  }

  private assertDimensions(vector: number[] | undefined): number[] {
    if (!Array.isArray(vector) || vector.length !== this.dimensions) {
      throw new EmbeddingError(
        this.name,
        200,
        `el vector llegó con ${vector?.length ?? 0} dimensiones y se esperaban ${this.dimensions} ` +
          '(EMBEDDING_DIMENSIONS debe coincidir con la columna vector de la base).',
      );
    }
    return vector;
  }
}

function describeBody(raw: string, status: number): string {
  if (!raw) return `HTTP ${status} sin detalle`;
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string }; message?: string };
    const candidate = parsed.error?.message ?? parsed.message;
    if (candidate) return candidate.slice(0, 300);
  } catch {
    // cuerpo no JSON
  }
  return raw.replace(/\s+/g, ' ').slice(0, 300);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}
