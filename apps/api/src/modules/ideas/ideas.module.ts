import { Module } from '@nestjs/common';
import { IdeasController, ProfileIdeasController } from './ideas.controller';
import { IdeasService } from './ideas.service';
import { IdeasWorker } from './ideas.worker';

/** Ideas y calendario: generación (IA o plantilla), CRUD y el disparo a demanda. */
@Module({
  controllers: [IdeasController, ProfileIdeasController],
  providers: [IdeasService, IdeasWorker],
  exports: [IdeasService],
})
export class IdeasModule {}
