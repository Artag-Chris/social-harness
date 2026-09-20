/**
 * Resolución de la URL de Postgres. La usan TRES consumidores y por eso vive
 * aparte (sin zod ni Nest, para que `prisma/*.ts` la importe con ts-node):
 *  1. `src/config/env.ts` (validación al boot)
 *  2. `prisma/ensure-database.ts` (crea la base + la extensión antes de migrar)
 *  3. `prisma/seed.ts`
 *
 * Precedencia: DATABASE_URL directo > DATABASE_HOST/PORT + POSTGRES_* > default
 * de dev local. El compose del server arma DATABASE_URL apuntando a
 * `atiende-postgres`, así que ahí no hace falta tocar nada más.
 */

export const DEFAULT_DATABASE_URL =
  'postgresql://socialharness:socialharness@localhost:5435/socialharness?schema=public';

export function resolveDatabaseUrl(input: NodeJS.ProcessEnv = process.env): string {
  const direct = input.DATABASE_URL?.trim();
  if (direct) return direct;

  const host = input.DATABASE_HOST?.trim();
  if (!host) return DEFAULT_DATABASE_URL;

  const port = input.DATABASE_PORT?.trim() || '5432';
  const user = input.POSTGRES_USER?.trim() || 'socialharness';
  const pass = input.POSTGRES_PASSWORD ?? 'socialharness';
  const db = input.POSTGRES_DB?.trim() || 'socialharness';
  return `postgresql://${user}:${encodeURIComponent(pass)}@${host}:${port}/${db}?schema=public`;
}

/** Nombre de la base destino (la última parte del path). */
export function databaseNameFromUrl(url: string): string {
  const parsed = new URL(url);
  const name = parsed.pathname.replace(/^\//, '').trim();
  if (!name) throw new Error(`DATABASE_URL sin nombre de base: ${url}`);
  return name;
}

/**
 * La misma conexión pero apuntando a otra base. Se usa para conectarse a la base
 * de mantenimiento `postgres` y crear la base destino si no existe.
 */
export function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}
