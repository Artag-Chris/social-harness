import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { JsonLogger } from '../../common/json-logger.service';
import { QUEUES } from '../../config/queue.config';
import { PerformanceService, type PerformanceOutcome } from './performance.service';

/** Worker del reporte de rendimiento (una llamada de IA por corrida). */
@Processor(QUEUES.PERFORMANCE, { concurrency: 1 })
export class PerformanceWorker extends WorkerHost {
  constructor(
    private readonly performance: PerformanceService,
    private readonly logger: JsonLogger,
  ) {
    super();
  }

  async process(job: Job<{ profileId: string; days: number }>): Promise<PerformanceOutcome> {
    const outcome = await this.performance.runForProfile(job.data.profileId, job.data.days);

    this.logger.log(
      {
        msg: 'Reporte de rendimiento terminado',
        profileId: outcome.profileId,
        reportId: outcome.reportId,
        usedLlm: outcome.usedLlm,
        ...outcome.measures,
        skipped: outcome.skipped ?? null,
      },
      'Performance',
    );

    return outcome;
  }
}
