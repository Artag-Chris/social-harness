import { Module } from '@nestjs/common';
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
 * Las colas se configuran en `QueueModule` (global), así que acá solo se usan. Todo
 * corre sobre la **Redis compartida** con `QUEUE_PREFIX=socialharness`, así que sus
 * llaves conviven con las de atiende y cv-harness sin pisarse.
 */
@Module({
  imports: [IngestionModule],
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
