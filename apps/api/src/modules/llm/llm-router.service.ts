import type {
  LlmChatRequest,
  LlmJsonRequest,
  LlmJsonResult,
  LlmProviderPort,
  LlmResult,
} from './llm-provider.port';
import { LlmUnavailableError } from './llm.errors';

/**
 * Router de proveedores: principal → respaldo.
 *
 * Por qué existe: que el proveedor de IA se caiga (o devuelva un JSON que no
 * cumple el contrato) no debería tumbar el ciclo. El router intenta el principal
 * y, si falla, prueba el respaldo configurado.
 *
 * Reglas:
 *  - Si no hay IA real (`mock`), `json()` devuelve `null` de una: no hay nada que
 *    intentar y el llamador ya sabe caer a su respaldo determinístico.
 *  - Si ambos fallan, se lanza `LlmUnavailableError` con los DOS motivos: cuando
 *    algo se rompe, el log tiene que decir por qué falló cada proveedor, no solo
 *    el último.
 *  - `provider`/`model` en el resultado son los del proveedor que contestó de
 *    verdad, así el gasto registrado (`CoachRun`) queda atribuido al correcto.
 */
export class LlmRouterService implements LlmProviderPort {
  constructor(
    private readonly primary: LlmProviderPort,
    private readonly fallback: LlmProviderPort | null = null,
  ) {}

  get name(): string {
    return 'router';
  }

  /** Modelo del principal (lo que se muestra en `/config`). */
  get model(): string {
    return this.primary.model;
  }

  get isMock(): boolean {
    return this.primary.isMock;
  }

  /** Proveedor primario configurado (para logs y diagnóstico). */
  get primaryName(): string {
    return this.primary.name;
  }

  /** Respaldo configurado, o null si no hay. */
  get fallbackName(): string | null {
    return this.fallback?.name ?? null;
  }

  async chat(request: LlmChatRequest): Promise<LlmResult> {
    try {
      return await this.primary.chat(request);
    } catch (error) {
      if (!this.fallback || this.primary.isMock) throw error;
      try {
        return await this.fallback.chat(request);
      } catch (fallbackError) {
        throw new LlmUnavailableError([
          `${this.primary.name}: ${describe(error)}`,
          `${this.fallback.name}: ${describe(fallbackError)}`,
        ]);
      }
    }
  }

  async json<T>(request: LlmJsonRequest<T>): Promise<LlmJsonResult<T> | null> {
    // Sin IA real no hay nada que intentar: null es la señal de "usá tu respaldo".
    if (this.primary.isMock) return null;

    try {
      return await this.primary.json(request);
    } catch (error) {
      if (!this.fallback) throw error;
      try {
        return await this.fallback.json(request);
      } catch (fallbackError) {
        throw new LlmUnavailableError([
          `${this.primary.name}: ${describe(error)}`,
          `${this.fallback.name}: ${describe(fallbackError)}`,
        ]);
      }
    }
  }

  async isHealthy(): Promise<boolean> {
    if (await this.primary.isHealthy()) return true;
    return this.fallback ? this.fallback.isHealthy() : false;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
