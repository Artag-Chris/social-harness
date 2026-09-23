import { Module } from '@nestjs/common';
import { GrowthController } from './growth.controller';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

/** Métricas manuales de las cuentas (entrada del reporte de rendimiento). */
@Module({
  controllers: [MetricsController, GrowthController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
