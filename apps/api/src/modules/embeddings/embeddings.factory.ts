import { env } from '../../config/env';
import type { EmbeddingProviderPort } from './embedding-provider.port';
import { MockEmbeddingsProvider } from './mock/mock-embeddings.provider';
import { OpenAiEmbeddingsProvider } from './openai/openai-embeddings.provider';

/**
 * Factory de embeddings: mismo criterio que el de IA (un solo lugar sabe qué
 * adaptador corresponde a cada nombre resuelto del `.env`). Sumar Voyage o
 * cualquier otro es agregar su adaptador y su caso acá.
 *
 * Vive aparte del módulo Nest para que los scripts de diagnóstico puedan usarla
 * sin arrastrar el contenedor de dependencias.
 */
export function createEmbeddingProvider(
  mode: 'openai' | 'mock',
  config: typeof env = env,
): EmbeddingProviderPort {
  switch (mode) {
    case 'openai':
      return new OpenAiEmbeddingsProvider(config);
    case 'mock':
      return new MockEmbeddingsProvider(config.EMBEDDING_DIMENSIONS);
    default: {
      const unknown: never = mode;
      throw new Error(`Proveedor de embeddings desconocido: ${String(unknown)}`);
    }
  }
}
