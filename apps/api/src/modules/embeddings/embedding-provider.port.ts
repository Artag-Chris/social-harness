/**
 * Puerto de embeddings (patrón adaptador, igual que el de IA).
 *
 * Los consume la similitud de señales en pgvector (`Signal.embedding`) y, más
 * adelante, el match perfil ↔ tendencia. El pipeline pide vectores por acá y no
 * sabe si los generó OpenAI o el mock.
 *
 * ⚠️ `dimensions` NO es un detalle de implementación: la columna es
 * `vector(1536)` en la base. Si un proveedor devolviera otra dimensión, se falla
 * ruidosamente en vez de guardar vectores incompatibles (que romperían la
 * búsqueda después, y en silencio).
 */

export class EmbeddingError extends Error {
  constructor(
    readonly provider: string,
    /** 0 = no hubo respuesta (red o tiempo agotado). */
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'EmbeddingError';
  }

  get isRetryable(): boolean {
    return this.status === 0 || this.status === 408 || this.status === 425 || this.status === 429 || this.status >= 500;
  }
}

export interface EmbeddingProviderPort {
  readonly name: string;
  readonly model: string;
  readonly dimensions: number;
  readonly isMock: boolean;
  /** Devuelve un vector por texto, en el MISMO orden. */
  embed(texts: string[], signal?: AbortSignal): Promise<number[][]>;
}

/** Token de inyección del proveedor de embeddings resuelto por configuración. */
export const EMBEDDING_PROVIDER_TOKEN = 'EMBEDDING_PROVIDER_TOKEN';
