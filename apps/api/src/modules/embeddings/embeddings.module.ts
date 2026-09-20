import { Global, Module } from '@nestjs/common';
import { env } from '../../config/env';
import {
  EMBEDDING_PROVIDER_TOKEN,
  type EmbeddingProviderPort,
} from './embedding-provider.port';
import { createEmbeddingProvider } from './embeddings.factory';

/**
 * Módulo de embeddings, publicado con `EMBEDDING_PROVIDER_TOKEN`.
 * Sin `OPENAI_API_KEY` el modo resuelto es `mock` y el pipeline sigue andando.
 */
@Global()
@Module({
  providers: [
    {
      provide: EMBEDDING_PROVIDER_TOKEN,
      useFactory: (): EmbeddingProviderPort => createEmbeddingProvider(env.embedMode),
    },
  ],
  exports: [EMBEDDING_PROVIDER_TOKEN],
})
export class EmbeddingsModule {}
