import type {
  LlmChatRequest,
  LlmJsonRequest,
  LlmJsonResult,
  LlmProviderPort,
  LlmResult,
} from '../llm-provider.port';

/**
 * Proveedor `mock`: sin IA real, sin red y sin gasto.
 *
 * Existe para que TODO el pipeline se pueda correr de punta a punta con
 * `docker compose up` recién clonado, sin llaves. Su contrato es el que hace que
 * eso funcione:
 *  - `json()` devuelve **null** (no un objeto inventado): el llamador detecta que
 *    no hay IA y usa su respaldo determinístico. Devolver datos falsos sería
 *    peor que no devolver nada, porque se guardarían como si fueran reales.
 *  - `chat()` devuelve un texto que se ANUNCIA como mock: si algún día aparece
 *    en pantalla, se ve de dónde salió en vez de confundirse con una respuesta
 *    del modelo.
 */
export class MockLlmProvider implements LlmProviderPort {
  readonly isMock = true;
  readonly model = 'mock';

  get name(): string {
    return 'mock';
  }

  async chat(_request: LlmChatRequest): Promise<LlmResult> {
    return {
      text: '[modo mock] Sin proveedor de IA configurado: este texto no lo generó un modelo.',
      provider: this.name,
      model: this.model,
      usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
      costUsd: 0,
      latencyMs: 0,
    };
  }

  async json<T>(_request: LlmJsonRequest<T>): Promise<LlmJsonResult<T> | null> {
    return null;
  }

  async isHealthy(): Promise<boolean> {
    return true;
  }
}
