import 'dotenv/config';
import { z } from 'zod';
import { resolveDatabaseUrl } from './database-url';

/**
 * Configuración validada al boot (fail-fast, patrón de atiende).
 *
 * Reglas que se respetan acá:
 *  - Un booleano se parsea con enum + transform, NUNCA con `z.coerce.boolean`:
 *    `z.coerce.boolean("false")` da `true` (string no vacío) y es un bug clásico.
 *  - `LLM_PROVIDER=auto` (y `EMBEDDING_PROVIDER=auto`) degrada a `mock` cuando no
 *    hay llaves: así el pipeline completo corre E2E sin red ni gasto.
 *  - Si se pide un proveedor EXPLÍCITO sin su llave, se falla al boot en vez de
 *    arrancar con mock silencioso (el `superRefine` de abajo).
 */

const boolFromEnv = (defaultValue: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(defaultValue)
    .transform((value) => value === 'true');

/**
 * Una URL mal formada tiene que fallar ACÁ (con el nombre de la variable), no
 * reventar después en un `new URL()` durante el import de otro módulo, donde el
 * error no dice qué variable está mal.
 */
function isParseableUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/** CSV → lista limpia (sin entradas vacías por comas de más). */
function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * Número opcional: ausente o vacío = `undefined`.
 * Con `z.coerce.number()` a secas, un `""` del `.env` se convertiría en 0 y no
 * se notaría (el precio quedaría en cero sin que nadie lo pida).
 *
 * Sin anotar el tipo de retorno a propósito: `z.preprocess` devuelve un
 * `ZodEffects` cuyo tipo de entrada es `unknown`, y anotarlo como `ZodType<number>`
 * rompe la inferencia del esquema.
 */
const optionalNumber = () =>
  z.preprocess(
    (value) => (value === '' || value === undefined || value === null ? undefined : value),
    z.coerce.number().nonnegative().optional(),
  );

const envSchema = z
  .object({
    // ── Aplicación ─────────────────────────────────────────────────────────
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().default(3200),
    // Mismo nombre que usa atiende, para que la convención no cambie entre
    // proyectos del ecosistema.
    CORS_ALLOWED_ORIGINS: z.string().default('*'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    TRUST_PROXY: z.coerce.number().default(0),

    // ── Base de datos / colas ──────────────────────────────────────────────
    // DATABASE_URL puede venir directo o derivarse de DATABASE_HOST/POSTGRES_*
    // (por eso no se valida acá: lo resuelve resolveDatabaseUrl).
    QUEUE_PREFIX: z.string().min(1).default('socialharness'),
    REDIS_URL: z
      .string()
      .min(1)
      .default('redis://localhost:6380')
      .refine(isParseableUrl, {
        message: 'REDIS_URL no es una URL válida (ej. redis://host:6379).',
      }),

    // ── IA (patrón adaptador: un puerto + un adaptador por proveedor) ──────
    // auto = deepseek > groq > mock (mock permite correr E2E sin llaves).
    LLM_PROVIDER: z.enum(['auto', 'deepseek', 'groq', 'mock']).default('auto'),
    // Respaldo cuando el principal falla. auto = el otro proveedor con llave.
    LLM_FALLBACK: z.enum(['auto', 'deepseek', 'groq', 'none']).default('auto'),
    LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).default(60000),
    LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
    LLM_MAX_TOKENS: z.coerce.number().int().min(1).default(4096),
    // Precio del modelo propio si no está en la tabla de `pricing.ts` (solo telemetría).
    LLM_PRICE_INPUT_PER_1M: optionalNumber(),
    LLM_PRICE_OUTPUT_PER_1M: optionalNumber(),

    DEEPSEEK_API_KEY: z.string().default(''),
    DEEPSEEK_MODEL: z.string().default('deepseek-chat'),
    DEEPSEEK_BASE_URL: z.string().default(''),
    GROQ_API_KEY: z.string().default(''),
    GROQ_MODEL: z.string().default('llama-3.3-70b-versatile'),
    GROQ_BASE_URL: z.string().default(''),

    EMBEDDING_PROVIDER: z.enum(['auto', 'openai', 'mock']).default('auto'),
    OPENAI_API_KEY: z.string().default(''),
    OPENAI_BASE_URL: z.string().default(''),
    EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
    EMBEDDING_DIMENSIONS: z.coerce.number().int().min(1).default(1536),
    EMBEDDING_BATCH_SIZE: z.coerce.number().int().min(1).max(2048).default(100),
    EMBEDDING_TIMEOUT_MS: z.coerce.number().int().min(1000).default(60000),

    // ── Fuentes de tendencia ───────────────────────────────────────────────
    YOUTUBE_API_KEY: z.string().default(''),
    TRENDS_REGION: z.string().default('CO'),
    RSS_NEWS_EDITION: z.string().default('es-419'),
    RESPECT_ROBOTS: boolFromEnv('true'),
    SOURCE_DEFAULT_INTERVAL_HOURS: z.coerce.number().int().min(1).default(24),
    /**
     * Conectores habilitados (CSV). Es un FEATURE FLAG de verdad, no una
     * deducción: tener la llave de YouTube y querer apagar ese conector son
     * cosas distintas. Un `kind` que no esté acá no se despacha nunca, aunque
     * tenga fuentes configuradas. Sumar un conector = agregar su adaptador y su
     * `kind` al enum (el default de acá se actualiza solo vía SourceKind).
     */
    FEATURE_CONNECTORS: z.string().default('YOUTUBE_API,GOOGLE_TRENDS,RSS,PUBLIC_WEB,MANUAL'),

    // ── Auth (JWT compartido con atiende) ─────────────────────────────────
    JWT_SECRET: z.string().min(1).default('dev-secret-change-me'),
    JWT_EXPIRES_IN: z.string().default('1d'),

    // ── Scheduler / pipeline / costos ─────────────────────────────────────
    CRON_INTERVAL_MINUTES: z.coerce.number().int().min(1).default(360),
    RELEVANCE_MIN_SCORE: z.coerce.number().min(0).max(100).default(60),
    IDEAS_PER_WEEK: z.coerce.number().int().min(1).max(50).default(3),
    AUTO_IDEAS_ENABLED: boolFromEnv('true'),
    DEDUP_ENABLED: boolFromEnv('true'),
    DEDUP_INTERVAL_MINUTES: z.coerce.number().int().min(1).default(720),
    ANALYZE_BATCH_SIZE: z.coerce.number().int().min(1).max(200).default(20),

    // ── Notificaciones / fixture ──────────────────────────────────────────
    NOTIFY_CHANNELS: z.string().default('dashboard'),
    FIXTURE_ENABLED: boolFromEnv('false'),
    FIXTURE_BASE_URL: z
      .string()
      .default('http://localhost:8091')
      .refine(isParseableUrl, {
        message: 'FIXTURE_BASE_URL no es una URL válida (ej. http://socialharness-fixture).',
      }),
  })
  .superRefine((value, ctx) => {
    const missing = (variable: string, message: string): void => {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [variable], message });
    };

    /** Un proveedor se "usa" si es el principal o el respaldo. */
    const usedAsLlm = (provider: 'deepseek' | 'groq'): boolean =>
      value.LLM_PROVIDER === provider || value.LLM_FALLBACK === provider;

    const where = `LLM_PROVIDER="${value.LLM_PROVIDER}", LLM_FALLBACK="${value.LLM_FALLBACK}"`;

    if (usedAsLlm('deepseek') && value.DEEPSEEK_API_KEY.length === 0) {
      missing(
        'DEEPSEEK_API_KEY',
        `Se pidió deepseek (${where}) pero DEEPSEEK_API_KEY está vacía.`,
      );
    }
    if (usedAsLlm('groq') && value.GROQ_API_KEY.length === 0) {
      missing('GROQ_API_KEY', `Se pidió groq (${where}) pero GROQ_API_KEY está vacía.`);
    }
    if (value.EMBEDDING_PROVIDER === 'openai' && value.OPENAI_API_KEY.length === 0) {
      missing(
        'OPENAI_API_KEY',
        'Se pidió EMBEDDING_PROVIDER="openai" pero OPENAI_API_KEY está vacía.',
      );
    }

    // La columna `Signal.embedding` es `vector(1536)`: si esto no coincide, los
    // vectores no se pueden guardar ni comparar. Falla en el boot, no a mitad del
    // pipeline con datos ya escritos.
    if (value.EMBEDDING_DIMENSIONS !== SCHEMA_VECTOR_DIMENSIONS) {
      missing(
        'EMBEDDING_DIMENSIONS',
        `EMBEDDING_DIMENSIONS=${value.EMBEDDING_DIMENSIONS} no coincide con la columna ` +
          `vector(${SCHEMA_VECTOR_DIMENSIONS}) de Signal.embedding. Si cambiás de modelo, primero migrá el schema.`,
      );
    }
  });

export type RawEnv = z.infer<typeof envSchema>;

/**
 * Dimensiones de `Signal.embedding` en el schema Prisma (`vector(1536)`).
 * Vive acá para que la configuración y la migración no se puedan desincronizar
 * en silencio: si `EMBEDDING_DIMENSIONS` no coincide, el boot falla.
 */
export const SCHEMA_VECTOR_DIMENSIONS = 1536;

/** Proveedor de IA efectivo tras resolver `auto`. */
export type LlmMode = 'deepseek' | 'groq' | 'mock';
export type EmbedMode = 'openai' | 'mock';
/** Respaldo de IA (nunca puede ser el mismo que el principal ni `mock`). */
export type LlmFallback = 'deepseek' | 'groq';

export type Env = RawEnv & {
  /** URL de Postgres ya resuelta (DATABASE_URL directo o derivada). */
  databaseUrl: string;
  llmMode: LlmMode;
  /** Proveedor de respaldo resuelto (`null` = sin respaldo, o sin llaves). */
  llmFallback: LlmFallback | null;
  embedMode: EmbedMode;
  /** NOTIFY_CHANNELS parseado a lista. */
  notifyChannels: string[];
  /** CORS_ALLOWED_ORIGINS parseado a lista (`*` = cualquiera). */
  corsAllowedOrigins: string[];
  /** FEATURE_CONNECTORS parseado a lista (el nombre se valida en features.ts). */
  connectorKinds: string[];
};

/**
 * REDIS_URL se puede setear directo o derivarse de REDIS_HOST/REDIS_PORT/
 * REDIS_PASSWORD (mismo patrón que atiende): así el harness reutiliza la Redis
 * compartida del server sin duplicar configuración.
 *
 * El default de dev local apunta al 6380 porque ahí publica cv-harness el
 * contenedor `redis` compartido (dentro de la red es `redis:6379`).
 */
export function resolveRedisUrl(input: NodeJS.ProcessEnv): string {
  const direct = input.REDIS_URL?.trim();
  if (direct) return direct;

  const host = input.REDIS_HOST?.trim();
  if (!host) return 'redis://localhost:6380';

  const port = input.REDIS_PORT?.trim() || '6379';
  const pass = input.REDIS_PASSWORD;
  const auth = pass ? `:${encodeURIComponent(pass)}@` : '';
  return `redis://${auth}${host}:${port}`;
}

function resolveLlmMode(parsed: RawEnv): LlmMode {
  if (parsed.LLM_PROVIDER === 'deepseek') return 'deepseek';
  if (parsed.LLM_PROVIDER === 'groq') return 'groq';
  if (parsed.LLM_PROVIDER === 'mock') return 'mock';
  // auto: deepseek > groq > mock (mock permite correr E2E sin llaves).
  if (parsed.DEEPSEEK_API_KEY.length > 0) return 'deepseek';
  if (parsed.GROQ_API_KEY.length > 0) return 'groq';
  return 'mock';
}

function resolveEmbedMode(parsed: RawEnv): EmbedMode {
  if (parsed.EMBEDDING_PROVIDER === 'mock') return 'mock';
  if (parsed.EMBEDDING_PROVIDER === 'openai') return 'openai';
  return parsed.OPENAI_API_KEY.length > 0 ? 'openai' : 'mock';
}

/**
 * Respaldo de IA: nunca el mismo que el principal, y nunca `mock` (caer a mock
 * "funcionaría" pero devolvería null y el pipeline se quedaría sin ideas sin
 * decir por qué: es mejor fallar y que se vea).
 */
export function resolveLlmFallback(parsed: RawEnv, primary: LlmMode): LlmFallback | null {
  if (parsed.LLM_FALLBACK === 'none') return null;

  const available: LlmFallback[] = [];
  if (parsed.GROQ_API_KEY.length > 0) available.push('groq');
  if (parsed.DEEPSEEK_API_KEY.length > 0) available.push('deepseek');

  if (parsed.LLM_FALLBACK === 'auto') {
    return available.find((provider) => provider !== primary) ?? null;
  }

  // Explícito: el `superRefine` ya garantizó que hay llave.
  return parsed.LLM_FALLBACK === primary ? null : parsed.LLM_FALLBACK;
}

export function parseEnv(input: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.parse({
    ...input,
    REDIS_URL: resolveRedisUrl(input),
  });

  const llmMode = resolveLlmMode(parsed);

  return {
    ...parsed,
    databaseUrl: resolveDatabaseUrl(input),
    llmMode,
    llmFallback: resolveLlmFallback(parsed, llmMode),
    embedMode: resolveEmbedMode(parsed),
    notifyChannels: splitCsv(parsed.NOTIFY_CHANNELS),
    corsAllowedOrigins: splitCsv(parsed.CORS_ALLOWED_ORIGINS),
    connectorKinds: splitCsv(parsed.FEATURE_CONNECTORS),
  };
}

/** Formatea los errores de Zod en un mensaje accionable (no un dump crudo). */
export function formatEnvIssues(error: z.ZodError): string {
  const lines = error.issues.map((issue) => {
    const path = issue.path.join('.') || '(raíz)';
    return `  · ${path}: ${issue.message}`;
  });
  return `Configuración inválida (.env):\n${lines.join('\n')}`;
}

function loadEnv(): Env {
  try {
    return parseEnv();
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(formatEnvIssues(error));
    }
    throw error;
  }
}

/** Instancia global parseada una vez (`dotenv/config` carga apps/api/.env). */
export const env: Env = loadEnv();
