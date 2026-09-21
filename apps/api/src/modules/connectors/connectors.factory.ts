import { SourceKind } from '@prisma/client';
import { env, type Env } from '../../config/env';
import { GoogleTrendsConnector } from './google-trends/google-trends.connector';
import { ManualConnector } from './manual/manual.connector';
import { PublicWebConnector } from './public-web/public-web.connector';
import { RssConnector } from './rss/rss.connector';
import type { TrendConnectorPort } from './trend-connector.port';
import { YoutubeConnector } from './youtube/youtube.connector';

/**
 * Factory de conectores: el ÚNICO lugar que sabe qué adaptador corresponde a cada
 * tipo de fuente. Sumar un tipo = crear su adaptador + su caso acá (y su `kind` al
 * enum de Prisma); el scheduler y la ingestión no se tocan.
 *
 * El `switch` cierra con `never`: si se agrega un tipo y se olvida registrarlo,
 * **no compila**.
 */
export function createConnector(kind: SourceKind, config: Env = env): TrendConnectorPort {
  switch (kind) {
    case SourceKind.RSS:
      return new RssConnector();
    case SourceKind.PUBLIC_WEB:
      return new PublicWebConnector();
    case SourceKind.YOUTUBE_API:
      return new YoutubeConnector(config.YOUTUBE_API_KEY);
    case SourceKind.GOOGLE_TRENDS:
      return new GoogleTrendsConnector(config.TRENDS_REGION);
    case SourceKind.MANUAL:
      return new ManualConnector();
    default: {
      const unknown: never = kind;
      throw new Error(`Tipo de fuente desconocido: ${String(unknown)}`);
    }
  }
}

/** Todos los conectores por tipo, construidos una vez al arrancar. */
export type ConnectorRegistry = Map<SourceKind, TrendConnectorPort>;

export function createConnectorRegistry(config: Env = env): ConnectorRegistry {
  const registry: ConnectorRegistry = new Map();
  for (const kind of Object.values(SourceKind)) {
    registry.set(kind, createConnector(kind, config));
  }
  return registry;
}
