import type { SourceKind } from '@prisma/client';
import type { ConnectorResult } from './signal-draft.schema';

/**
 * Puerto de un conector de tendencias (patrón adaptador).
 *
 * Un adaptador por `kind` de fuente, registrado en la factory del módulo y
 * resuelto por configuración. El pipeline nunca nombra un portal concreto: si
 * mañana entra una fuente nueva del mismo tipo, es una fila en la base; si es de
 * un tipo nuevo, es un adaptador más.
 */
export interface TrendConnectorContext {
  /** Correlación con la corrida (`CollectionRun.requestId`). */
  requestId: string;
  sourceId: string;
  sourceName: string;
  /** Config del conector tal como quedó guardada en `Source.params`. */
  params: Record<string, unknown>;
  /** Política de cortesía: maxPages, delayMs, timeoutMs, respectRobots. */
  limits: SourceLimits;
}

export interface SourceLimits {
  maxPages?: number;
  maxItems?: number;
  delayMs?: number;
  timeoutMs?: number;
  respectRobots?: boolean;
  userAgent?: string;
  headers?: Record<string, string>;
}

export interface TrendConnectorPort {
  /** Tipo de fuente que atiende este adaptador. */
  readonly kind: SourceKind;
  /** Nombre legible para la UI ("YouTube (API oficial)", "Feed RSS", ...). */
  readonly label: string;
  /**
   * ¿Tiene lo que necesita para correr? (p. ej. YouTube necesita su llave).
   *
   * Un conector no configurado se **saltea con un aviso** en vez de fallar en
   * cada ciclo: una fuente que siempre falla llena la bandeja de errores y tapa
   * los problemas reales.
   */
  readonly isConfigured: boolean;
  /**
   * Trae las señales. Debe:
   *  - respetar `limits` (páginas, delay, timeout, robots);
   *  - devolver avisos en `warnings` en vez de lanzar por cosas no fatales;
   *  - lanzar SOLO si la fuente entera es inutilizable (así la corrida queda
   *    FAILED con un motivo claro y las demás fuentes siguen).
   */
  fetch(ctx: TrendConnectorContext, signal?: AbortSignal): Promise<ConnectorResult>;
}

/** Token de inyección de la factory de conectores (se registra en fase 2). */
export const TREND_CONNECTORS_TOKEN = 'TREND_CONNECTORS_TOKEN';
