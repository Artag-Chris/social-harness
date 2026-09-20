import { Global, Module } from '@nestjs/common';
import { env } from '../../config/env';
import { createLlmProvider } from './llm.factory';
import { LLM_PROVIDER_TOKEN, type LlmProviderPort } from './llm-provider.port';
import { LlmRouterService } from './llm-router.service';

/**
 * Módulo de IA: arma el router (principal + respaldo) desde el `.env` y lo
 * publica con `LLM_PROVIDER_TOKEN`.
 *
 * Los servicios del pipeline inyectan ESE token y nunca una clase concreta: por
 * eso cambiar de proveedor es configuración y no refactor.
 */
@Global()
@Module({
  providers: [
    {
      provide: LLM_PROVIDER_TOKEN,
      useFactory: (): LlmProviderPort => {
        const primary = createLlmProvider(env.llmMode);
        const fallback = env.llmFallback ? createLlmProvider(env.llmFallback) : null;
        return new LlmRouterService(primary, fallback);
      },
    },
  ],
  exports: [LLM_PROVIDER_TOKEN],
})
export class LlmModule {}
