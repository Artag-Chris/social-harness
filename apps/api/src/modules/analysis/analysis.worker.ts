import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { JsonLogger } from '../../common/json-logger.service';
import { QUEUES } from '../../config/queue.config';
import { AnalysisService, type AnalysisOutcome } from './analysis.service';

/**
 * Worker del análisis.
 *
 * `concurrency: 1` a propósito: el análisis es una llamada de IA por perfil y no
 * conviene pisarse (dos jobs del mismo perfil gastarían dos veces). Serializado, el
 * segundo encuentra las señales ya marcadas y no gasta nada.
 */
@Processor(QUEUES.ANALYZE, { concurrency: 1 })
export class AnalysisWorker extends WorkerHost {
  constructor(
    private readonly analysis: AnalysisService,
    private readonly logger: JsonLogger,
  ) {
    super();
  }

  async process(job: Job<{ profileId: string }>): Promise<AnalysisOutcome> {
    const outcome = await this.analysis.analyzeProfile(job.data.profileId);

    this.logger.log(
      {
        msg: 'Análisis terminado',
        profileId: outcome.profileId,
        analyzed: outcome.analyzed,
        topScore: outcome.topScore,
        usedLlm: outcome.usedLlm,
        ideas: outcome.ideasEnqueued,
        skipped: outcome.skipped ?? null,
      },
      'Analyze',
    );

    return outcome;
  }
}
