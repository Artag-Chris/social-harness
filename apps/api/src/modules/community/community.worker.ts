import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { JsonLogger } from '../../common/json-logger.service';
import { QUEUES } from '../../config/queue.config';
import { CommunityService, type ProposeSegmentsOutcome } from './community.service';

/**
 * Worker del coach de comunidad.
 *
 * Un solo worker para la cola: los jobs se distinguen por `job.name`, así sumar el plan
 * diario o la propuesta de comunidades no agrega procesos ni colas nuevas.
 */
@Processor(QUEUES.COMMUNITY, { concurrency: 1 })
export class CommunityWorker extends WorkerHost {
  constructor(
    private readonly community: CommunityService,
    private readonly logger: JsonLogger,
  ) {
    super();
  }

  async process(job: Job<{ profileId: string }>): Promise<ProposeSegmentsOutcome> {
    if (job.name === 'segments-propose') {
      const outcome = await this.community.runPropose(job.data.profileId);

      this.logger.log(
        {
          msg: 'Propuesta de audiencia terminada',
          profileId: outcome.profileId,
          created: outcome.created,
          archived: outcome.archived,
          usedLlm: outcome.usedLlm,
          skipped: outcome.skipped ?? null,
        },
        'Community',
      );

      return outcome;
    }

    throw new Error(`Job de comunidad desconocido: ${job.name}`);
  }
}
