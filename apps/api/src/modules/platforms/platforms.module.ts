import { Module } from '@nestjs/common';
import { PlatformsController } from './platforms.controller';

/**
 * Módulo de redes/formatos. Solo lee el catálogo: no tiene estado propio.
 * Lo consumen la UI (`GET /platforms`), los conectores (para etiquetar señales)
 * y las fases de perfiles/ideas (para validar red + formato).
 */
@Module({
  controllers: [PlatformsController],
})
export class PlatformsModule {}
