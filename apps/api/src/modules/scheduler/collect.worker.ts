import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { JsonLogger } from '../../common/json-logger.service';
import { QUEUES } from '../../config/queue.config';
import { CollectionService, type CollectOutcome, type CollectPayload } from './collection.service';

/**
 * Worker de recolección.
 *
 * `concurrency: 2` a propósito: son descargas a sitios de terceros, no conviene
 * martillarlos en paralelo, y así un sitio lento no bloquea al resto.
 *
 * Si `process` lanza, BullMQ reintenta con backoff (ver `JOB_OPTIONS`) y la
 * corrida queda registrada como FAILED con el motivo.
 */
@Processor(QUEUES.COLLECT, { concurrency: 2 })
export class CollectWorker extends WorkerHost {
  constructor(
    private readonly collection: CollectionService,
    private readonly logger: JsonLogger,
  ) {
    super();
  }

  async process(job: Job<CollectPayload>): Promise<CollectOutcome> {
    const outcome = await this.collection.collect(job.data);

    this.logger.log(
      {
        msg: 'Recolección terminada',
        sourceId: job.data.sourceId,
        status: outcome.status,
        itemsFound: outcome.itemsFound ?? 0,
        created: outcome.summary?.created ?? 0,
        alreadyKnown: outcome.summary?.alreadyKnown ?? 0,
        warning: outcome.reason ?? outcome.warnings?.[0] ?? null,
      },
      'Collect',
    );

    return outcome;
  }
}
