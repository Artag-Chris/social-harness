/**
 * db:reset — deja la base del harness como nueva (esquema vacío, sin extensión).
 *
 * Para qué existe: hay un estado del que no se sale sin limpiar la base. Si una
 * migración falla **después** de crear tablas (p. ej. un `CREATE INDEX` al final), Prisma
 * deja el registro del intento fallido y esas tablas a medias: `migrate deploy` se niega a
 * seguir (P3009) y volver a aplicar la migración choca contra los objetos que ya existen.
 *
 * El harness NO lo hace solo (no puede saber si esas tablas tienen datos tuyos), así que
 * queda este comando explícito. Usa la MISMA `DATABASE_URL` que la app, así que no hay
 * que adivinar el contenedor ni el nombre de la base.
 *
 *   docker compose run --rm api npm run db:reset -- --force
 *
 * Borra: la extensión `vector` (si no, queda registrada sin sus objetos y la migración
 * vuelve a fallar por el tipo inexistente), el esquema `public` y lo recrea vacío. El
 * próximo arranque migra, asegura el índice y siembra de cero.
 *
 * Es destructivo a propósito y por eso exige `--force`: sin el flag no hace nada y
 * explica qué haría.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { resolveDatabaseUrl } from '../src/config/database-url';

async function main(): Promise<void> {
  const url = resolveDatabaseUrl();
  const forced = process.argv.includes('--force');

  // Se muestra el destino SIEMPRE: es lo primero que hay que poder verificar antes de
  // borrar algo.
  let target = url;
  try {
    const parsed = new URL(url);
    target = `${parsed.hostname}:${parsed.port || 5432}/${parsed.pathname.replace('/', '')}`;
  } catch {
    // Si no se puede parsear, se muestra la URL tal cual (mejor eso que nada).
  }

  if (!forced) {
    console.log(
      `[db:reset] NO se hizo nada (falta --force).\n` +
        `[db:reset] Haría esto en ${target}:\n` +
        '  DROP EXTENSION IF EXISTS vector CASCADE;\n' +
        '  DROP SCHEMA public CASCADE;\n' +
        '  CREATE SCHEMA public;\n' +
        '[db:reset] Ojo: borra TODAS las tablas de esa base. Si ahí hay datos que querés, no lo corras.',
    );
    return;
  }

  const client = new PrismaClient({ datasources: { db: { url } } });

  try {
    console.log(`[db:reset] limpiando ${target} (esquema public + extensión vector)`);
    await client.$executeRawUnsafe('DROP EXTENSION IF EXISTS vector CASCADE');
    await client.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
    await client.$executeRawUnsafe('CREATE SCHEMA public');
    console.log(
      '[db:reset] listo: la base quedó vacía.\n' +
        '[db:reset] Ahora levantá el api (`docker compose up -d api`): migra, asegura el índice y siembra.',
    );
  } finally {
    await client.$disconnect();
  }
}

void main().catch((err: unknown) => {
  const detail = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[db:reset] FALLO: ${detail}\n`);
  process.exit(1);
});
