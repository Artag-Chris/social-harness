/**
 * ensure-index — corre en CADA boot, DESPUÉS de `prisma migrate deploy`.
 *
 * El índice HNSW necesita la tabla `Signal`, así que no puede crearse antes de
 * migrar: en una base nueva la tabla no existe y el boot fallaba con
 * `relation "Signal" does not exist`, dejando el contenedor reiniciando en bucle.
 *
 * Es **tolerante a propósito**: si no se puede asegurar el índice, se avisa y se
 * sigue. El índice es performance (similitud por vectores), no correctitud: la app
 * funciona sin él, solo más lenta en esas búsquedas. Un índice que no se pudo
 * crear no puede impedir que el harness arranque.
 */
import 'dotenv/config';
import { resolveDatabaseUrl } from '../src/config/database-url';
import { ensureVectorIndex } from './ensure-database';

async function main(): Promise<void> {
  await ensureVectorIndex(resolveDatabaseUrl());
}

void main().catch((err: unknown) => {
  const detail = err instanceof Error ? err.message : String(err);
  process.stderr.write(
    `[ensure-index] aviso: no se pudo asegurar el índice HNSW (${detail}). ` +
      'El harness arranca igual; solo las búsquedas por similitud quedan más lentas.\n',
  );
});
