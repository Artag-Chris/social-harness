import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthPayload } from '../auth/auth.types';
import {
  MetricListQuerySchema,
  MetricSnapshotInputSchema,
  type MetricListQuery,
  type MetricSnapshotInput,
} from './metrics.schema';
import { MetricsService } from './metrics.service';

/**
 * Métricas de una cuenta. Acepta un snapshot suelto o un CSV pegado (una fila por
 * día) — es la vía manual del ADR-002 mientras no haya conector oficial.
 */
@ApiTags('metrics')
@ApiBearerAuth()
@Controller('accounts/:accountId/metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @ApiOperation({ summary: 'Snapshots de la cuenta (por defecto, los últimos 90 días)' })
  list(
    @CurrentUser() user: AuthPayload,
    @Param('accountId') accountId: string,
    @Query(new ZodValidationPipe(MetricListQuerySchema)) query: MetricListQuery,
  ) {
    return this.metrics.list(user, accountId, query);
  }

  @Post()
  @ApiOperation({
    summary: 'Cargar métricas: un snapshot suelto o un CSV (reimportar el mismo día actualiza)',
  })
  import(
    @CurrentUser() user: AuthPayload,
    @Param('accountId') accountId: string,
    @Body(new ZodValidationPipe(MetricSnapshotInputSchema)) input: MetricSnapshotInput,
  ) {
    return this.metrics.import(user, accountId, input);
  }
}
