import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthPayload } from '../auth/auth.types';
import { GrowthQuerySchema, type GrowthQuery } from './metrics.schema';
import { MetricsService } from './metrics.service';

/**
 * Crecimiento y gap de objetivos del perfil.
 *
 * Va en su propio controlador porque la ruta es del **perfil**, no de una cuenta: la
 * pregunta es "¿voy a llegar a mis objetivos?", no "¿cómo viene esta cuenta?".
 *
 * Y es gratis (aritmética, sin IA), así que el dashboard puede refrescarlo sin pensar en
 * el gasto.
 */
@ApiTags('metrics')
@ApiBearerAuth()
@Controller('profiles/:profileId/growth')
export class GrowthController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @ApiOperation({
    summary: 'Crecimiento por cuenta y gap de objetivos (calculado; no usa IA)',
  })
  get(
    @CurrentUser() user: AuthPayload,
    @Param('profileId') profileId: string,
    @Query(new ZodValidationPipe(GrowthQuerySchema)) query: GrowthQuery,
  ) {
    return this.metrics.growth(user, profileId, query);
  }
}
