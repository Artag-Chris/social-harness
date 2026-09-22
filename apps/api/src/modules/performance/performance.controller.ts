import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AccessScope } from '../auth/access-scope.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthPayload } from '../auth/auth.types';
import { PerformanceService } from './performance.service';

const RunSchema = z.object({
  /** Cuánto mira atrás el reporte. */
  days: z.coerce.number().int().min(7).max(365).default(30),
});

const ListSchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) });

type RunInput = z.infer<typeof RunSchema>;
type ListQuery = z.infer<typeof ListSchema>;

/**
 * Reporte de rendimiento por perfil.
 *
 * Es a demanda (no corre en el ciclo automático): depende de que el humano haya
 * cargado métricas, y encima cuesta una llamada de IA.
 */
@ApiTags('performance')
@ApiBearerAuth()
@Controller('profiles/:profileId/performance')
export class PerformanceController {
  constructor(
    private readonly performance: PerformanceService,
    private readonly access: AccessScope,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Últimos reportes del perfil' })
  list(
    @CurrentUser() user: AuthPayload,
    @Param('profileId') profileId: string,
    @Query(new ZodValidationPipe(ListSchema)) query: ListQuery,
  ) {
    return this.performance.list(user, profileId, query.limit);
  }

  @Post('run')
  @HttpCode(202)
  @ApiOperation({ summary: 'Armar un reporte ahora (encolado). Sin métricas cargadas no gasta IA' })
  async run(
    @CurrentUser() user: AuthPayload,
    @Param('profileId') profileId: string,
    @Body(new ZodValidationPipe(RunSchema)) input: RunInput,
  ): Promise<{ queued: true }> {
    await this.access.assertProfile(user, profileId);
    await this.performance.requestRun(profileId, input.days);
    return { queued: true };
  }
}
