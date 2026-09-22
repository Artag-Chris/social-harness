import { Module } from '@nestjs/common';
import { PerformanceController } from './performance.controller';
import { PerformanceService } from './performance.service';
import { PerformanceWorker } from './performance.worker';

/** Reporte de rendimiento a demanda (qué funcionó, qué no y qué ajustar). */
@Module({
  controllers: [PerformanceController],
  providers: [PerformanceService, PerformanceWorker],
  exports: [PerformanceService],
})
export class PerformanceModule {}
