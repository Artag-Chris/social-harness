import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { JsonLogger } from '../../common/json-logger.service';
import { QUEUES } from '../../config/queue.config';
import { IdeasService, type GenerateIdeasOutcome } from './ideas.service';

/**
 * Worker de ideas. `concurrency: 1`: son llamadas de IA y el resultado se escribe en
 * el calendario, así que no conviene pisarse.
 */
@Processor(QUEUES.IDEAS, { concurrency: 1 })
export class IdeasWorker extends WorkerHost {
  constructor(
    private readonly ideas: IdeasService,
    private readonly logger: JsonLogger,
  ) {
    super();
  }

  async process(job: Job<{ profileId: string }>): Promise<GenerateIdeasOutcome> {
    const outcome = await this.ideas.generateForProfile(job.data.profileId);

    this.logger.log(
      {
        msg: 'Generación de ideas terminada',
        profileId: outcome.profileId,
        created: outcome.created,
        usedLlm: outcome.usedLlm,
        rejected: outcome.rejected,
        skipped: outcome.skipped ?? null,
      },
      'Ideas',
    );

    return outcome;
  }
}
