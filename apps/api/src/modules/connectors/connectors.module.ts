import { Global, Module } from '@nestjs/common';
import { createConnectorRegistry } from './connectors.factory';
import { TREND_CONNECTORS_TOKEN } from './trend-connector.port';

/**
 * Registro de conectores, disponible por inyección con `TREND_CONNECTORS_TOKEN`.
 *
 * Global porque lo consumen el scheduler (recolección) y, más adelante, el
 * análisis: nadie debería instanciar un conector por su cuenta.
 */
@Global()
@Module({
  providers: [
    {
      provide: TREND_CONNECTORS_TOKEN,
      useFactory: () => createConnectorRegistry(),
    },
  ],
  exports: [TREND_CONNECTORS_TOKEN],
})
export class ConnectorsModule {}
