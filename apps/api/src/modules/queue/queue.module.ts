import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { bullConnection, QUEUES } from '../../config/queue.config';

/**
 * Wiring de las colas, en un solo lugar.
 *
 * `forRoot` (la conexión a la Redis compartida) + el registro de todas las colas.
 * Al ser global, los módulos que encolan o consumen solo piden `@InjectQueue(...)`
 * sin volver a configurar nada — antes esto vivía dentro del scheduler y no era
 * visible para el análisis ni para las ideas.
 */
@Global()
@Module({
  imports: [
    BullModule.forRoot({
      connection: bullConnection.connection,
      prefix: bullConnection.prefix,
    }),
    BullModule.registerQueue(...Object.values(QUEUES).map((name) => ({ name }))),
  ],
  exports: [BullModule],
})
export class QueueModule {}
