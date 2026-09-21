import { Global, Module } from '@nestjs/common';
import { JsonLogger } from './json-logger.service';

/**
 * Logger JSON como provider global.
 *
 * Estaba solo en `AppModule`, así que los módulos de features (workers, ingestión,
 * recolección) no podían inyectarlo. Al ser global, cualquiera lo recibe sin
 * importar nada — y sigue siendo el mismo formato de una línea por evento.
 */
@Global()
@Module({
  providers: [JsonLogger],
  exports: [JsonLogger],
})
export class LoggingModule {}
