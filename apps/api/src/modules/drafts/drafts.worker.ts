import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { JsonLogger } from '../../common/json-logger.service';
import { QUEUES } from '../../config/queue.config';
import { DraftsService, type DraftOutcome } from './drafts.service';

/** Worker de borradores. `concurrency: 1`: es una llamada de IA por pedido. */
@Processor(QUEUES.DRAFT, { concurrency: 1 })
export class DraftsWorker extends WorkerHost {
  constructor(
    private readonly drafts: DraftsService,
    private readonly logger: JsonLogger,
  ) {
    super();
  }

  async process(job: Job<{ ideaId: string }>): Promise<DraftOutcome> {
    const outcome = await this.drafts.generateForIdea(job.data.ideaId);

    this.logger.log(
      {
        msg: 'Borrador terminado',
        ideaId: outcome.ideaId,
        draftId: outcome.draftId,
        version: outcome.version,
        usedLlm: outcome.usedLlm,
        skipped: outcome.skipped ?? null,
      },
      'Drafts',
    );

    return outcome;
  }
}
