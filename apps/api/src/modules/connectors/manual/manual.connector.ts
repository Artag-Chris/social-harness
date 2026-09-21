import { SourceKind } from '@prisma/client';
import type { ConnectorResult } from '../signal-draft.schema';
import type { TrendConnectorPort } from '../trend-connector.port';

/**
 * Conector `manual`: no recolecta nada.
 *
 * Existe por dos motivos:
 *  1. la fuente "inspiración/competencia" del catálogo tiene que poder
 *     despacharse sin romper nada (es una fuente más, aunque no traiga items);
 *  2. deja explícito dónde entra lo que no se puede automatizar: por
 *     `POST /signals/from-text` (pegar URL o texto), que usa el MISMO pipeline.
 */
export class ManualConnector implements TrendConnectorPort {
  readonly kind = SourceKind.MANUAL;
  readonly label = 'Manual (inspiración / competencia)';
  readonly isConfigured = true;

  async fetch(): Promise<ConnectorResult> {
    return {
      items: [],
      diagnostics: [],
      warnings: [
        'Las fuentes manuales no recolectan solas: lo que pegás entra por la pestaña de inspiración (POST /signals/from-text).',
      ],
    };
  }
}
