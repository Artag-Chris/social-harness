import { env, type Env } from '../../config/env';
import { createDeepSeekProvider } from './deepseek/deepseek.provider';
import { createGroqProvider } from './groq/groq.provider';
import { MockLlmProvider } from './mock/mock.provider';
import type { LlmProviderPort } from './llm-provider.port';

/**
 * Nombres de proveedor soportados. Es una lista corta y cerrada a propósito: el
 * `.env` se valida contra ella, así que un typo no puede activar un proveedor
 * inexistente en silencio.
 */
export type LlmProviderName = 'deepseek' | 'groq' | 'mock';

/**
 * Factory de proveedores: el ÚNICO lugar que sabe qué adaptador corresponde a
 * cada nombre. Agregar un proveedor = crear su adaptador + sumarlo acá (y su
 * nombre al enum del `.env`); el pipeline no se toca.
 */
export function createLlmProvider(name: LlmProviderName, config: Env = env): LlmProviderPort {
  switch (name) {
    case 'deepseek':
      return createDeepSeekProvider(config);
    case 'groq':
      return createGroqProvider(config);
    case 'mock':
      return new MockLlmProvider();
    default: {
      // Exhaustividad en tiempo de compilación: si se suma un nombre al tipo y
      // se olvida acá, esto no compila.
      const unknown: never = name;
      throw new Error(`Proveedor de IA desconocido: ${String(unknown)}`);
    }
  }
}
