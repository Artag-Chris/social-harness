/**
 * Diagnóstico de la capa de IA.
 *
 * Para qué: cuando algo "no genera ideas" o cuando se cambia de proveedor, esto
 * responde en 5 segundos qué quedó resuelto y si la llave y el modelo funcionan
 * de verdad —sin arrancar el pipeline ni esperar un ciclo.
 *
 * Hace UNA llamada real mínima (pocos tokens) y muestra tokens y costo estimado,
 * así que también sirve para verificar el precio del modelo.
 *
 * Uso:
 *   cd apps/api && npm run llm:check        # usa apps/api/.env
 *   docker compose exec api npm run llm:check
 */
import 'dotenv/config';
import { z } from 'zod';
import { env } from '../src/config/env';
import { createEmbeddingProvider } from '../src/modules/embeddings/embeddings.factory';
import { createLlmProvider } from '../src/modules/llm/llm.factory';

const probeSchema = z.object({ ok: z.boolean(), ejemplo: z.string() });

function line(label: string, value: string): void {
  process.stdout.write(`${label.padEnd(22, '.')} ${value}\n`);
}

async function main(): Promise<void> {
  line('Proveedor principal', env.llmMode);
  line('Respaldo', env.llmFallback ?? '(ninguno)');
  line('Modelo', env.llmMode === 'groq' ? env.GROQ_MODEL : env.DEEPSEEK_MODEL);
  line('Timeout / reintentos', `${env.LLM_TIMEOUT_MS} ms / ${env.LLM_MAX_RETRIES}`);
  line('Embeddings', `${env.embedMode} (${env.EMBEDDING_MODEL}, ${env.EMBEDDING_DIMENSIONS} dims)`);
  process.stdout.write('\n');

  if (env.llmMode === 'mock') {
    line('IA real', 'NO (modo mock: sin llave, no se hace ninguna llamada)');
    return;
  }

  const provider = createLlmProvider(env.llmMode);

  line('GET /models', (await provider.isHealthy()) ? 'OK' : 'FALLÓ (revisá llave/base URL)');

  process.stdout.write('\n── Llamada real de prueba (JSON) ──\n');
  const started = Date.now();
  const result = await provider.json({
    system: 'Sos un asistente de prueba. Respondés siempre en json.',
    user: 'Devolvé un objeto con ok=true y ejemplo="hola".',
    schema: probeSchema,
    hint: '{ "ok": boolean, "ejemplo": string }',
    task: 'llm-check',
    maxTokens: 200,
  });

  if (!result) {
    line('Respuesta', 'null (el proveedor resolvió a mock)');
    return;
  }

  line('Datos', JSON.stringify(result.data));
  line('Contestó', `${result.meta.provider} / ${result.meta.model}`);
  line('Tokens in / out', `${result.meta.usage.inputTokens} / ${result.meta.usage.outputTokens}`);
  line('Costo estimado', `USD ${result.meta.costUsd}`);
  line('Latencia', `${result.meta.latencyMs} ms (total ${Date.now() - started} ms)`);

  process.stdout.write('\n── Embeddings ──\n');
  const embeddings = createEmbeddingProvider(env.embedMode);
  const vectors = await embeddings.embed(['prueba de dimensiones']);
  line('Vector', `${vectors[0]?.length ?? 0} dimensiones (esperado: ${env.EMBEDDING_DIMENSIONS})`);
  line('Proveedor', `${embeddings.name} / ${embeddings.model}`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`\nFALLO: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
