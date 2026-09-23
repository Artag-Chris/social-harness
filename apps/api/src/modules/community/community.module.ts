import { Module } from '@nestjs/common';
import { CommunityController } from './community.controller';
import { CommunityService } from './community.service';
import { CommunityWorker } from './community.worker';

/**
 * Coach de comunidad.
 *
 * Exporta el servicio porque los otros coaches consumen la audiencia: ideas y borradores
 * para escribir, el reporte para interpretar. La dependencia va en un solo sentido (los
 * otros importan a este), así que no hay ciclos.
 */
@Module({
  controllers: [CommunityController],
  providers: [CommunityService, CommunityWorker],
  exports: [CommunityService],
})
export class CommunityModule {}
