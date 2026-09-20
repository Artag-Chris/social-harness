import { SourceKind } from '@prisma/client';
import { env } from './env';

/**
 * Feature flags derivadas del entorno, agrupadas por capacidad.
 *
 * Para qué: que el resto del código pregunte por CAPACIDAD y no por variables de
 * entorno sueltas (`features.ideas.auto` en vez de leer `AUTO_IDEAS_ENABLED`).
 * Así, cuando una capacidad se vuelva configurable por perfil o por negocio, se
 * cambia acá y no en los servicios.
 *
 * Segunda capa (futuro, ya contemplada en el modelo): `Profile.autoIdeasEnabled`
 * y `Profile.ideasPerWeek` sobrescriben estos valores por perfil.
 */
export interface Features {
  llm: {
    /** Proveedor principal resuelto (mock = sin llaves, determinístico). */
    provider: 'deepseek' | 'groq' | 'mock';
    /** Respaldo resuelto (null = ninguno). */
    fallback: 'deepseek' | 'groq' | null;
    /** Modelo del principal, tal como está en el `.env`. */
    model: string;
    maxTokens: number;
    /** Embeddings resueltos (mock = vector determinístico, sin red). */
    embeddings: 'openai' | 'mock';
    embeddingsModel: string;
  };
  /** Conectores habilitados. Un `kind` apagado no se despacha aunque tenga fuentes. */
  connectors: Record<SourceKind, boolean>;
  /** Defaults que usan los conectores al construir consultas. */
  sources: {
    region: string;
    newsEdition: string;
    respectRobots: boolean;
  };
  /** Generación automática de ideas (el único automatismo que cuesta IA). */
  ideas: {
    auto: boolean;
    perWeek: number;
    relevanceMinScore: number;
    analyzeBatchSize: number;
  };
  /** Dedup de señales (marca y oculta duplicados; nunca borra). */
  dedup: {
    enabled: boolean;
    intervalMinutes: number;
  };
  /** Canales de aviso activos. `dashboard` (bandeja en BD) siempre está. */
  notifications: {
    channels: string[];
  };
  scheduler: {
    intervalMinutes: number;
    sourceDefaultIntervalHours: number;
  };
  fixtures: {
    enabled: boolean;
    baseUrl: string;
  };
}

/** Todos los tipos de fuente que existen (derivados del enum, no de una lista a mano). */
export const ALL_SOURCE_KINDS = Object.values(SourceKind) as SourceKind[];

/** Modelo que corresponde al proveedor principal (para mostrarlo en `/config` y en el boot). */
export function primaryModelFor(config: typeof env): string {
  switch (config.llmMode) {
    case 'deepseek':
      return config.DEEPSEEK_MODEL;
    case 'groq':
      return config.GROQ_MODEL;
    case 'mock':
      return 'mock';
    default: {
      const unknown: never = config.llmMode;
      throw new Error(`Proveedor de IA desconocido: ${String(unknown)}`);
    }
  }
}

/**
 * Convierte la lista de `FEATURE_CONNECTORS` en un mapa completo.
 *
 * - Se construye desde el enum: un `kind` nuevo queda contemplado sin tocar esto.
 * - Falla si el CSV tiene un valor desconocido: un typo ("RRS") apagaría el
 *   conector en silencio, que es la peor forma de fallar (nadie lo nota hasta
 *   que faltan señales). Mejor que el boot no arranque.
 */
export function resolveConnectors(configured: string[]): Record<SourceKind, boolean> {
  const unknown = configured.filter((kind) => !ALL_SOURCE_KINDS.includes(kind as SourceKind));
  if (unknown.length > 0) {
    throw new Error(
      `FEATURE_CONNECTORS tiene valores desconocidos: ${unknown.join(', ')}. ` +
        `Válidos: ${ALL_SOURCE_KINDS.join(', ')}.`,
    );
  }

  return ALL_SOURCE_KINDS.reduce<Record<SourceKind, boolean>>(
    (accumulator, kind) => {
      accumulator[kind] = configured.includes(kind);
      return accumulator;
    },
    {} as Record<SourceKind, boolean>,
  );
}

/** Los `kind` habilitados, como lista (para el dispatcher y para `GET /config`). */
export function enabledConnectors(current: Features): SourceKind[] {
  return ALL_SOURCE_KINDS.filter((kind) => current.connectors[kind]);
}

export function buildFeatures(config: typeof env = env): Features {
  return {
    llm: {
      provider: config.llmMode,
      fallback: config.llmFallback,
      model: primaryModelFor(config),
      maxTokens: config.LLM_MAX_TOKENS,
      embeddings: config.embedMode,
      embeddingsModel: config.EMBEDDING_MODEL,
    },
    connectors: resolveConnectors(config.connectorKinds),
    sources: {
      region: config.TRENDS_REGION,
      newsEdition: config.RSS_NEWS_EDITION,
      respectRobots: config.RESPECT_ROBOTS,
    },
    ideas: {
      auto: config.AUTO_IDEAS_ENABLED,
      perWeek: config.IDEAS_PER_WEEK,
      relevanceMinScore: config.RELEVANCE_MIN_SCORE,
      analyzeBatchSize: config.ANALYZE_BATCH_SIZE,
    },
    dedup: {
      enabled: config.DEDUP_ENABLED,
      intervalMinutes: config.DEDUP_INTERVAL_MINUTES,
    },
    notifications: {
      channels: config.notifyChannels,
    },
    scheduler: {
      intervalMinutes: config.CRON_INTERVAL_MINUTES,
      sourceDefaultIntervalHours: config.SOURCE_DEFAULT_INTERVAL_HOURS,
    },
    fixtures: {
      enabled: config.FIXTURE_ENABLED,
      baseUrl: config.FIXTURE_BASE_URL,
    },
  };
}

export const features: Features = buildFeatures();
