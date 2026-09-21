import { Module } from '@nestjs/common';
import { IngestionService } from './ingestion.service';

/**
 * Ingestión: el único punto de entrada de señales al pipeline (dedup + fan-out a
 * los perfiles suscritos). Lo consumen el scheduler (recolección) y, más adelante,
 * el análisis.
 */
@Module({
  providers: [IngestionService],
  exports: [IngestionService],
})
export class IngestionModule {}
