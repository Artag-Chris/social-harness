import { env } from './env';

/**
 * Nombres de las colas BullMQ (pipeline interno) y de las llaves de Redis.
 *
 * BullMQ NO permite ':' en el nombre de la cola, así que el aislamiento entre
 * proyectos que comparten la misma Redis se hace con la opción `prefix` de Bull
 * (`QUEUE_PREFIX`, por defecto `socialharness`).
 *
 * No hay Redis Streams en este harness: a diferencia de cv-harness, acá no hay
 * una segunda lengua al otro lado (el scraper es TypeScript). Si algún día se
 * suma un conector externo, entra por un stream con `payload` JSON validado y el
 * resto del pipeline no cambia (ver docs/adr-001).
 */
export const QUEUES = {
  SCHEDULE: 'schedule',
  COLLECT: 'collect',
  ANALYZE: 'analyze',
  IDEAS: 'ideas',
  DRAFT: 'draft',
  PERFORMANCE: 'performance',
  DEDUP: 'dedup',
  NOTIFICATION: 'notification',
  /** Coach de comunidad: propuesta de audiencia, de comunidades y el plan del día. */
  COMMUNITY: 'community',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** Ids de jobs repeatable (el cron vive dentro de Nest, como en cv-harness). */
export const REPEATABLE_JOBS = {
  SCHEDULE_CYCLE: 'schedule-cycle',
  DEDUP_CYCLE: 'dedup-cycle',
} as const;

const parsedRedis = new URL(env.REDIS_URL);

/**
 * Conexión compartida para BullMQ (producers y workers). `maxRetriesPerRequest:
 * null` es requisito de BullMQ para workers bloqueantes.
 */
export const bullConnection = {
  prefix: env.QUEUE_PREFIX,
  connection: {
    host: parsedRedis.hostname,
    port: Number(parsedRedis.port || 6379),
    username: parsedRedis.username ? decodeURIComponent(parsedRedis.username) : undefined,
    password: parsedRedis.password ? decodeURIComponent(parsedRedis.password) : undefined,
    maxRetriesPerRequest: null,
  },
};

/** Opciones de retry por defecto de los jobs del pipeline. */
export const JOB_OPTIONS = {
  attempts: 4,
  backoff: { type: 'exponential', delay: 3000 },
  removeOnComplete: { age: 86400, count: 1000 },
  removeOnFail: { age: 7 * 86400 },
} as const;
