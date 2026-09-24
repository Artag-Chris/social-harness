import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { JsonLogger } from '../../common/json-logger.service';
import { QUEUES } from '../../config/queue.config';
import {
  CommunityService,
  type ProposeSegmentsOutcome,
  type ProposeTargetsOutcome,
} from './community.service';

/**
 * Worker del coach de comunidad.
 *
 * Un solo worker para la cola: los jobs se distinguen por `job.name`, así sumar el plan
 * diario no agrega procesos ni colas nuevas.
 */
@Processor(QUEUES.COMMUNITY, { concurrency: 1 })
export class CommunityWorker extends WorkerHost {
  constructor(
    private readonly community: CommunityService,
    private readonly logger: JsonLogger,
  ) {
    super();
  }

  async process(
    job: Job<{ profileId: string; segmentId?: string | null }>,
  ): Promise<ProposeSegmentsOutcome | ProposeTargetsOutcome> {
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

    if (job.name === 'targets-propose') {
      const outcome = await this.community.runProposeTargets(job.data.profileId, job.data.segmentId);

      this.logger.log(
        {
          msg: 'Propuesta de comunidades terminada',
          profileId: outcome.profileId,
          created: outcome.created,
          skipped: outcome.skipped,
          usedLlm: outcome.usedLlm,
          skippedReason: outcome.skippedReason ?? null,
        },
        'Community',
      );

      return outcome;
    }

    throw new Error(`Job de comunidad desconocido: ${job.name}`);
  }
}
