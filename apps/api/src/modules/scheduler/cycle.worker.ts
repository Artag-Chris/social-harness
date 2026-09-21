import { Processor, WorkerHost } from '@nestjs/bullmq';
import { JsonLogger } from '../../common/json-logger.service';
import { QUEUES } from '../../config/queue.config';
import { DispatchService, type CycleSummary } from './dispatch.service';

/**
 * Worker del ciclo (`schedule-cycle`, cada `CRON_INTERVAL_MINUTES`): busca los
 * perfiles vencidos y encola sus fuentes. Es barato: solo lee la base y encola.
 */
@Processor(QUEUES.SCHEDULE)
export class CycleWorker extends WorkerHost {
  constructor(
    private readonly dispatch: DispatchService,
    private readonly logger: JsonLogger,
  ) {
    super();
  }

  async process(): Promise<CycleSummary> {
    const summary = await this.dispatch.runCycle();

    this.logger.log(
      {
        msg: 'Ciclo de recolección despachado',
        profiles: summary.profilesConsidered,
        sources: summary.sourcesDispatched,
        skipped: summary.skipped.length,
      },
      'Cycle',
    );

    return summary;
  }
}
