import { Module } from '@nestjs/common';
import { DraftsController } from './drafts.controller';
import { DraftsService } from './drafts.service';
import { DraftsWorker } from './drafts.worker';

/** Borradores a demanda (nunca automáticos: ADR-001/003). */
@Module({
  controllers: [DraftsController],
  providers: [DraftsService, DraftsWorker],
  exports: [DraftsService],
})
export class DraftsModule {}
