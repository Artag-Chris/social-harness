/**
 * ensure-index — corre en CADA boot, DESPUÉS de `prisma migrate deploy`.
 *
 * Qué hace: asegura el índice HNSW de `Signal.embedding` (similitud por vectores) y
 * reporta la versión de pgvector, que es el dato que hace falta cuando algo falla.
 *
 * Por qué NO está en una migración: es HNSW sobre una columna que Prisma marcó como
 * `Unsupported`, así que
 *   (a) cada `migrate dev` genera un `DROP INDEX` de este índice, y
 *   (b) al vivir en la migración `init`, un server con pgvector viejo hacía fallar
 *       TODA la migración (P3009) y el arranque quedaba bloqueado por un índice.
 * Acá es idempotente y **tolerante**: si no se puede crear, avisa y sigue. El índice
 * es performance, no correctitud: la app funciona sin él (búsquedas más lentas).
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { resolveDatabaseUrl } from '../src/config/database-url';

/** HNSW existe desde pgvector 0.5.0. */
const HNSW_MIN_VERSION = '0.5.0';

async function pgvectorVersion(client: PrismaClient): Promise<string> {
  const rows = await client.$queryRawUnsafe<Array<{ extversion: string }>>(
    "SELECT extversion FROM pg_extension WHERE extname = 'vector'",
  );
  return rows[0]?.extversion ?? 'no instalada';
}

async function main(): Promise<void> {
  const targetUrl = resolveDatabaseUrl();
  const client = new PrismaClient({ datasources: { db: { url: targetUrl } } });

  try {
    const version = await pgvectorVersion(client);
    console.log(`[ensure-index] pgvector ${version}`);

    await client.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS "Signal_embedding_hnsw_idx" ON "Signal" USING hnsw ("embedding" vector_cosine_ops)',
    );
    console.log('[ensure-index] índice HNSW de señales listo');
  } finally {
    await client.$disconnect();
  }
}

void main().catch((err: unknown) => {
  const detail = err instanceof Error ? err.message : String(err);
  process.stderr.write(
    `[ensure-index] aviso: no se pudo asegurar el índice HNSW (${detail}).\n` +
      `[ensure-index] el índice necesita pgvector >= ${HNSW_MIN_VERSION}. Si la versión es menor:\n` +
      '  - actualizá la extensión:  ALTER EXTENSION vector UPDATE;\n' +
      '  - o actualizá la imagen de Postgres (eran pgvector/pgvector:pg16).\n' +
      '[ensure-index] el harness arranca igual: solo la búsqueda por similitud queda más lenta.\n',
  );
});
