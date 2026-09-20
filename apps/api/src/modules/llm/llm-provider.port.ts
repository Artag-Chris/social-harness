import type { z } from 'zod';

/**
 * Puerto de proveedores de IA (patrón adaptador).
 *
 * El resto del sistema NO conoce a DeepSeek ni a Groq: pide texto o JSON por
 * este puerto. Cambiar de proveedor es registrar un adaptador y tocar el `.env`;
 * ningún servicio del pipeline se entera.
 *
 * Dos detalles del contrato que importan para el pipeline:
 *
 *  1. **`json()` devuelve `null` cuando no hay IA real** (modo `mock`). No es un
 *     error: es la señal para que el llamador use su respaldo determinístico y
 *     el pipeline pueda correr E2E sin llaves ni red. Por eso el tipo es
 *     `LlmJsonResult<T> | null` y no lanza en ese caso.
 *  2. **Todo JSON se valida con Zod antes de salir del adaptador.** El contrato
 *     de datos es del llamador, no del modelo: si el proveedor devuelve algo que
 *     no cumple, es `LlmInvalidJsonError` y se ve en el log en vez de romper tres
 *     capas más abajo.
 */

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  /** Tokens de entrada servidos desde caché (más baratos), si el proveedor lo informa. */
  cachedInputTokens: number;
}

export interface LlmChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmChatRequest {
  system: string;
  messages: LlmChatMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Pide modo JSON (`response_format`) cuando el proveedor lo soporta. */
  json?: boolean;
  signal?: AbortSignal;
}

export interface LlmResult {
  text: string;
  /** Qué proveedor contestó de verdad (importante cuando hay fallback). */
  provider: string;
  model: string;
  usage: LlmUsage;
  /** Costo estimado en USD según la tabla de precios (0 si el modelo es desconocido). */
  costUsd: number;
  latencyMs: number;
}

export interface LlmJsonRequest<T> {
  system: string;
  user: string;
  /** Contrato de la respuesta: se valida, no se confía. */
  schema: z.ZodType<T>;
  /** Nombre corto de la tarea, para logs y telemetría (p. ej. 'analyze-signals'). */
  task: string;
  /**
   * Descripción legible del contrato que se le pasa al modelo (guía al modelo;
   * lo que se EXIGE es el `schema`). Sin esto, el prompt no dice qué forma tiene
   * la respuesta y el modelo improvisa.
   */
  hint?: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface LlmJsonResult<T> {
  data: T;
  meta: LlmResult;
}

export interface LlmProviderPort {
  readonly name: string;
  readonly model: string;
  /** true = no hay IA real (mock determinístico). */
  readonly isMock: boolean;
  chat(request: LlmChatRequest): Promise<LlmResult>;
  json<T>(request: LlmJsonRequest<T>): Promise<LlmJsonResult<T> | null>;
  /** Chequeo manual (script de diagnóstico). NO se usa en /health: una llamada externa por cada healthcheck sería un abuso. */
  isHealthy(): Promise<boolean>;
}

/** Token de inyección del proveedor de IA (el router resuelto por configuración). */
export const LLM_PROVIDER_TOKEN = 'LLM_PROVIDER_TOKEN';
