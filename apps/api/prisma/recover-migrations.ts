/**
 * recover-migrations — corre en CADA boot, ANTES de `prisma migrate deploy`.
 *
 * Para qué existe: si una migración falla, Prisma deja el registro del intento en
 * `_prisma_migrations` y **se niega a aplicar cualquier otra** (P3009) hasta que
 * alguien lo resuelva a mano. En un server eso significa un arranque bloqueado con un
 * mensaje que no dice qué hacer.
 *
 * Qué hace, con una condición ESTRICTA para no ser peligroso:
 *   - Si el esquema `public` está **vacío** (0 tablas), la migración fallida no dejó
 *     nada (Prisma corre cada migración dentro de una transacción, así que se revierte
 *     entera): borra los registros de intentos sin terminar y deja seguir. No hay nada
 *     que perder porque no hay nada.
 *   - Si hay **alguna tabla**, NO toca nada: imprime el diagnóstico con los comandos y
 *     sale con error. Ahí sí puede haber datos y la decisión es de una persona.
 *
 * Es idempotente: si no hay intentos fallidos, no hace nada.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { resolveDatabaseUrl } from '../src/config/database-url';

interface FailedMigration {
  migration_name: string;
  started_at: Date | null;
}

async function tableExists(client: PrismaClient, name: string): Promise<boolean> {
  const rows = await client.$queryRawUnsafe<Array<{ exists: boolean }>>(
    'SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2) AS "exists"',
    'public',
    name,
  );
  return rows[0]?.exists === true;
}

async function publicTableCount(client: PrismaClient): Promise<number> {
  // Se excluye `_prisma_migrations`, que es la libreta de Prisma y no un dato del
  // proyecto: contarla hacía que este script nunca se animara a limpiar nada.
  const rows = await client.$queryRawUnsafe<Array<{ count: bigint }>>(
    "SELECT count(*) AS count FROM information_schema.tables " +
      "WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'",
  );
  return Number(rows[0]?.count ?? 0);
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

    const tables = await publicTableCount(client);
    const names = failed.map((row) => row.migration_name).join(', ');

    if (tables > 0) {
      process.stderr.write(
        `[recover-migrations] hay ${failed.length} migración(es) fallida(s) (${names}) y ${tables} tabla(s) en el esquema.\n` +
          '[recover-migrations] NO se toca nada automáticamente: puede haber datos y esa decisión es de una persona.\n' +
          '[recover-migrations] Si esa base es NUEVA y esas tablas no tienen nada tuyo (la migración fallida las dejó a medias):\n' +
          '  docker exec -it atiende-postgres psql -U atiende -d <base> \\\n' +
          '    -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"\n' +
          '  y volvé a levantar: la migración se aplica de cero.\n' +
          '[recover-migrations] Si esas tablas SÍ tienen datos, resolvelo a mano:\n' +
          '  npx prisma migrate resolve --rolled-back <migración>\n' +
          '[recover-migrations] En los dos casos se quita el registro del INTENTO; los datos no se tocan.\n',
      );
      process.exit(1);
    }

    console.log(
      `[recover-migrations] ${failed.length} migración(es) fallida(s) (${names}) y esquema vacío: ` +
        'se limpian los registros del intento (no hay datos que perder) y se reintenta migrar',
    );
    await client.$executeRawUnsafe('DELETE FROM "_prisma_migrations" WHERE finished_at IS NULL');
    console.log('[recover-migrations] listo');
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
