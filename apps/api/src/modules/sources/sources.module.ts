import { Module } from '@nestjs/common';
import { ProbeService } from './probe/probe.service';
import { SourcesController } from './sources.controller';
import { SourcesService } from './sources.service';

/**
 * Fuentes de tendencia: catálogo compartido + verificación antes de guardar.
 * Los conectores que las recolectan llegan en la fase 2 (mismo puerto).
 */
@Module({
  controllers: [SourcesController],
  providers: [SourcesService, ProbeService],
  exports: [SourcesService],
})
export class SourcesModule {}
