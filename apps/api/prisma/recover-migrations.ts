/**
 * recover-migrations — corre en CADA boot, ANTES de `prisma migrate deploy`.
 *
 * Para qué existe: si una migración falla, Prisma deja el registro del intento en
 * `_prisma_migrations` y **se niega a aplicar cualquier otra** (P3009) hasta que alguien
 * lo resuelva a mano. En un server eso es un arranque bloqueado con un mensaje que no dice
 * qué hacer.
 *
 * La condición para limpiar sola es **no poder perder datos**, y se verifica con dos
 * hechos, no con una suposición:
 *   1. Hay intentos de migración sin terminar.
 *   2. **Ninguna** de las tablas del proyecto tiene ni una fila.
 *
 * Si las dos se cumplen, se borran los registros del intento y las tablas/extension quedan
 * para que la migración las rehaga: no se pierde nada porque no hay nada. Si HAY datos en
 * cualquier tabla, no toca absolutamente nada y explica qué hacer (esa decisión es de una
 * persona).
 *
 * Caso real que lo motivó: la migración `init` falló en su ÚLTIMA sentencia (un índice), así
 * que dejó 15 tablas creadas y vacías más el registro del intento — y el arranque quedaba
 * en bucle sin salida.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { resolveDatabaseUrl } from '../src/config/database-url';

interface FailedMigration {
  migration_name: string;
  started_at: Date | null;
}

/** Solo se interpola un nombre de tabla si tiene forma de identificador. */
function assertSafeIdentifier(identifier: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Nombre de tabla inesperado: "${identifier}".`);
  }
}

async function tableExists(client: PrismaClient, name: string): Promise<boolean> {
  const rows = await client.$queryRawUnsafe<Array<{ exists: boolean }>>(
    'SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2) AS "exists"',
    'public',
    name,
  );
  return rows[0]?.exists === true;
}

async function projectTables(client: PrismaClient): Promise<string[]> {
  const rows = await client.$queryRawUnsafe<Array<{ table_name: string }>>(
    "SELECT table_name FROM information_schema.tables " +
      "WHERE table_schema = 'public' AND table_name <> '_prisma_migrations' ORDER BY table_name",
  );
  return rows.map((row) => row.table_name);
}

/**
 * Devuelve la primera tabla con al menos una fila (o `null` si todas están vacías).
 *
 * `EXISTS (SELECT 1 …)` corta en la primera fila: no recorre la tabla entera, así que es
 * barato incluso en tablas grandes.
 */
async function firstTableWithRows(client: PrismaClient, tables: string[]): Promise<string | null> {
  for (const table of tables) {
    assertSafeIdentifier(table);
    const rows = await client.$queryRawUnsafe<Array<{ has: boolean }>>(
      `SELECT EXISTS (SELECT 1 FROM "${table}") AS "has"`,
    );
    if (rows[0]?.has === true) return table;
  }
  return null;
}

async function main(): Promise<void> {
  const client = new PrismaClient({ datasources: { db: { url: resolveDatabaseUrl() } } });

  try {
    // Primer arranque de todos: la tabla todavía no existe → no hay nada que recuperar.
    if (!(await tableExists(client, '_prisma_migrations'))) return;

    const failed = await client.$queryRawUnsafe<FailedMigration[]>(
      'SELECT migration_name, started_at FROM "_prisma_migrations" WHERE finished_at IS NULL ORDER BY started_at',
    );
    if (failed.length === 0) return;

    const names = failed.map((row) => row.migration_name).join(', ');
    const tables = await projectTables(client);
    const withRows = await firstTableWithRows(client, tables);

    if (withRows !== null) {
      process.stderr.write(
        `[recover-migrations] hay ${failed.length} migración(es) sin terminar (${names}) y la tabla "${withRows}" TIENE filas.\n` +
          '[recover-migrations] NO se toca nada: puede haber datos y esa decisión es de una persona.\n' +
          '[recover-migrations] Para resolverlo:\n' +
          '  npx prisma migrate resolve --rolled-back <migración>\n' +
          '[recover-migrations] Si esos datos NO te importan y la base es nueva, se limpia entera con:\n' +
          '  docker compose run --rm api npx ts-node scripts/reset-database.ts --force\n',
      );
      process.exit(1);
    }

    console.log(
      `[recover-migrations] ${failed.length} migración(es) sin terminar (${names}), ` +
        `${tables.length} tabla(s) y NINGUNA con filas: se limpian los restos y se migra de nuevo ` +
        '(no hay datos que perder)',
    );
    // Se suelta la extensión además del esquema: si se borra solo el esquema, `vector`
    // queda registrada sin sus objetos y la migración falla por el tipo inexistente.
    await client.$executeRawUnsafe('DROP EXTENSION IF EXISTS vector CASCADE');
    await client.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
    await client.$executeRawUnsafe('CREATE SCHEMA public');
    console.log('[recover-migrations] listo: la migración se aplica desde cero');
  } finally {
    await client.$disconnect();
  }
}

void main().catch((err: unknown) => {
  const detail = err instanceof Error ? err.message : String(err);
  process.stderr.write(
    `[recover-migrations] aviso: no se pudo revisar el estado de las migraciones (${detail}).\n` +
      "Se sigue igual: si hay una migración fallida, `migrate deploy` va a decir P3009.\n",
  );
});
