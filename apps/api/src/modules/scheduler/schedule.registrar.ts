import { Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { JsonLogger } from '../../common/json-logger.service';
import { features } from '../../config/features';
import { JOB_OPTIONS, QUEUES, REPEATABLE_JOBS } from '../../config/queue.config';

/**
 * Registra el ciclo repetible al arrancar.
 *
 * El cron vive dentro de BullMQ (`repeat.every`) y no en un decorador `@Cron`: así
 * el estado del calendario queda en Redis, junto con las colas, y no depende de
 * que el proceso esté prendido en el instante exacto.
 *
 * `jobId` fijo: por más que el api se reinicie, queda UN solo ciclo agendado.
 */
@Injectable()
export class ScheduleRegistrar implements OnModuleInit {
  constructor(
    @InjectQueue(QUEUES.SCHEDULE) private readonly queue: Queue,
    private readonly logger: JsonLogger,
  ) {}

  async onModuleInit(): Promise<void> {
    const everyMs = features.scheduler.intervalMinutes * 60 * 1000;

    await this.queue.add(
      REPEATABLE_JOBS.SCHEDULE_CYCLE,
      {},
      {
        ...JOB_OPTIONS,
        jobId: REPEATABLE_JOBS.SCHEDULE_CYCLE,
        repeat: { every: everyMs },
      },
    );

    this.logger.log(
      {
        msg: 'Ciclo de recolección agendado',
        cadaMinutos: features.scheduler.intervalMinutes,
        cola: QUEUES.SCHEDULE,
      },
      'Scheduler',
    );
  }
}
