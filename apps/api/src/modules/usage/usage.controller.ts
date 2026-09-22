import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessScope } from '../auth/access-scope.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthPayload } from '../auth/auth.types';

/**
 * Control de gasto de IA: cuánto se usó y en qué.
 *
 * Existe porque el freno de costo tiene que ser visible: si no se ve, no se puede
 * decidir (por eso cada llamada deja una fila en `CoachRun`).
 *
 * Aviso conocido: si el modelo que devuelve el proveedor no está en la tabla de
 * precios (`LLM_PRICE_*_PER_1M`), el costo sale 0 aunque los tokens estén contados.
 */
@ApiTags('usage')
@ApiBearerAuth()
@Controller('usage')
export class UsageController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessScope,
  ) {}

  @Get()
  @ApiQuery({ name: 'days', required: false, type: Number })
  @ApiOperation({ summary: 'Tokens y costo por trabajo, y el detalle de los últimos días' })
  async usage(@CurrentUser() user: AuthPayload, @Query('days') days?: string): Promise<unknown> {
    const window = Math.min(365, Math.max(1, Number(days) || 30));
    const since = new Date(Date.now() - window * 86_400_000);

    const runs = await this.prisma.coachRun.findMany({
      where: {
        createdAt: { gte: since },
        // Los gastos sin perfil (si alguna vez los hay) también son del usuario que
        // pregunta? No: acá solo se muestra lo que cuelga de SUS perfiles.
        profile: this.access.profileWhere(user),
      },
      select: {
        job: true,
        model: true,
        tokensIn: true,
        tokensOut: true,
        costUsd: true,
        latencyMs: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const byJob = new Map<string, { job: string; runs: number; tokensIn: number; tokensOut: number; costUsd: number; avgLatencyMs: number }>();
    const byDay = new Map<string, { day: string; runs: number; tokensIn: number; tokensOut: number; costUsd: number }>();

    for (const run of runs) {
      const job = byJob.get(run.job) ?? { job: run.job, runs: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, avgLatencyMs: 0 };
      job.runs += 1;
      job.tokensIn += run.tokensIn;
      job.tokensOut += run.tokensOut;
      job.costUsd += run.costUsd;
      job.avgLatencyMs = Math.round((job.avgLatencyMs * (job.runs - 1) + run.latencyMs) / job.runs);
      byJob.set(run.job, job);

      const day = run.createdAt.toISOString().slice(0, 10);
      const daily = byDay.get(day) ?? { day, runs: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 };
      daily.runs += 1;
      daily.tokensIn += run.tokensIn;
      daily.tokensOut += run.tokensOut;
      daily.costUsd += run.costUsd;
      byDay.set(day, daily);
    }

    const totals = runs.reduce(
      (accumulator, run) => ({
        runs: accumulator.runs + 1,
        tokensIn: accumulator.tokensIn + run.tokensIn,
        tokensOut: accumulator.tokensOut + run.tokensOut,
        costUsd: accumulator.costUsd + run.costUsd,
      }),
      { runs: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 },
    );

    return {
      window: { days: window, from: since.toISOString(), to: new Date().toISOString() },
      totals: { ...totals, costUsd: round(totals.costUsd) },
      byJob: [...byJob.values()].map((job) => ({ ...job, costUsd: round(job.costUsd) })),
      byDay: [...byDay.values()].map((day) => ({ ...day, costUsd: round(day.costUsd) })).sort((a, b) => a.day.localeCompare(b.day)),
    };
  }
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
