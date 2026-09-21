import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { bullConnection, QUEUES } from '../../config/queue.config';
import { IngestionModule } from '../ingestion/ingestion.module';
import { CollectWorker } from './collect.worker';
import { CollectionService } from './collection.service';
import { CycleWorker } from './cycle.worker';
import { DispatchService } from './dispatch.service';
import { ProfileRunController } from './run.controller';
import { ScheduleRegistrar } from './schedule.registrar';

/**
 * Scheduler: el ciclo repetible, el despacho y los dos workers (ciclo y
 * recolección).
 *
 * Usa la **Redis compartida** del ecosistema con `QUEUE_PREFIX=socialharness`, así
 * que sus llaves conviven con las de atiende y cv-harness sin pisarse.
 */
@Module({
  imports: [
    BullModule.forRoot({
      connection: bullConnection.connection,
      prefix: bullConnection.prefix,
    }),
    BullModule.registerQueue({ name: QUEUES.SCHEDULE }, { name: QUEUES.COLLECT }),
    IngestionModule,
  ],
  controllers: [ProfileRunController],
  providers: [
    DispatchService,
    CollectionService,
    CollectWorker,
    CycleWorker,
    ScheduleRegistrar,
  ],
  exports: [DispatchService],
})
export class SchedulerModule {}
