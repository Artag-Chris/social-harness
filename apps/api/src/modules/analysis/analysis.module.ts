import { Module } from '@nestjs/common';
import { AnalysisService } from './analysis.service';
import { AnalysisWorker } from './analysis.worker';

/**
 * Análisis de relevancia por perfil (prefilter determinístico + una llamada de IA
 * por lote). El análisis encola las ideas, así que ambos viven en el mismo tramo
 * del pipeline.
 */
@Module({
  providers: [AnalysisService, AnalysisWorker],
  exports: [AnalysisService],
})
export class AnalysisModule {}
