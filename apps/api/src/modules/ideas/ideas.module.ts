import { Module } from '@nestjs/common';
import { CommunityModule } from '../community/community.module';
import { IdeasController, ProfileIdeasController } from './ideas.controller';
import { IdeasService } from './ideas.service';
import { IdeasWorker } from './ideas.worker';

/** Ideas y calendario: generación (IA o plantilla), CRUD y el disparo a demanda. */
@Module({
  imports: [CommunityModule],
  controllers: [IdeasController, ProfileIdeasController],
  providers: [IdeasService, IdeasWorker],
  exports: [IdeasService],
})
export class IdeasModule {}
