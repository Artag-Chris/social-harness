import { describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';
import type { PrismaService } from '../../prisma/prisma.service';
import type { LlmProviderPort } from '../llm/llm-provider.port';
import { PerformanceService } from './performance.service';

/**
 * Dos reglas que se prueban acá:
 *  1. Sin métricas cargadas NO se llama a la IA (un reporte sin datos es una opinión).
 *  2. Los deltas los calcula el código, no el modelo.
 */
function build(options: { snapshots?: unknown[]; llmNull?: boolean; objectives?: unknown[] } = {}) {
  const snapshots = options.snapshots ?? [
    { socialAccountId: 'a-1', capturedAt: new Date('2026-09-01'), followers: 1000, reach: 40000, engagementRate: 3, likes: 300 },
    { socialAccountId: 'a-1', capturedAt: new Date('2026-09-20'), followers: 1150, reach: 52000, engagementRate: 4, likes: 500 },
  ];

  const prisma = {
    profile: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'p-1',
        name: 'Mi marca',
        niche: ['ia'],
        audience: 'pymes',
        accounts: [{ id: 'a-1', platform: 'LINKEDIN', handle: '@marca' }],
        objectives: options.objectives ?? [],
      }),
    },
    metricSnapshot: { findMany: vi.fn().mockResolvedValue(snapshots) },
    contentIdea: { findMany: vi.fn().mockResolvedValue([{ title: 'Idea publicada', platform: 'LINKEDIN', format: 'POST', publishedAt: new Date('2026-09-10') }]) },
    profileSignal: { findMany: vi.fn().mockResolvedValue([{ relevanceScore: 90, signal: { title: 'Señal top' } }]) },
    performanceReport: {
      create: vi.fn().mockResolvedValue({ id: 'r-1' }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    coachRun: { create: vi.fn().mockResolvedValue({}) },
  };

  const llm: LlmProviderPort = {
    name: 'stub',
    model: 'stub',
    isMock: options.llmNull === true,
    chat: vi.fn(),
    json: vi.fn().mockResolvedValue(
      options.llmNull
        ? null
        : {
            data: {
              summary: 'El período cerró con crecimiento de seguidores y mejor engagement.',
              whatWorked: ['LinkedIn creció 150 seguidores.'],
              whatDidnt: [],
              adjustments: ['Publicá 3 veces por semana.'],
            },
            meta: {
              text: '',
              provider: 'deepseek',
              model: 'deepseek-chat',
              usage: { inputTokens: 700, outputTokens: 400, cachedInputTokens: 0 },
              costUsd: 0.0004,
              latencyMs: 9000,
            },
          },
    ),
    isHealthy: vi.fn().mockResolvedValue(true),
  };

  const queue = { add: vi.fn().mockResolvedValue({ id: 'job' }) } as unknown as Queue;
  const notifications = { notify: vi.fn().mockResolvedValue(undefined) };
  const access = { assertProfile: vi.fn().mockResolvedValue(undefined) };

  return {
    prisma,
    llm,
    notifications,
    service: new PerformanceService(
      prisma as unknown as PrismaService,
      access as never,
      notifications as never,
      llm,
      queue,
    ),
  };
}

describe('PerformanceService', () => {
  it('sin métricas cargadas no llama a la IA y avisa que faltan datos', async () => {
    const { service, llm, prisma, notifications } = build({ snapshots: [] });

    const outcome = await service.runForProfile('p-1');

    expect(outcome.reportId).toBeNull();
    expect(outcome.skipped).toContain('No hay métricas');
    expect(llm.json).not.toHaveBeenCalled();
    expect(prisma.performanceReport.create).not.toHaveBeenCalled();
    expect(notifications.notify).toHaveBeenCalled();
  });

  it('calcula los deltas por cuenta (el modelo interpreta, no suma)', async () => {
    const { service, llm } = build();

    const outcome = await service.runForProfile('p-1');

    expect(outcome.measures).toMatchObject({ accounts: 1, snapshots: 2, published: 1 });
    const prompt = (llm.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].user as string;
    // 1000 → 1150 y el alcance SUMA los dos snapshots.
    expect(prompt).toContain('seguidores: 1000 → 1150 (+150)');
    expect(prompt).toContain('alcance acumulado: 92000');
    expect(prompt).toContain('engagement promedio: 3.5 %');
  });

  it('guarda el reporte del modelo y registra el gasto', async () => {
    const { service, prisma } = build();

    const outcome = await service.runForProfile('p-1');

    expect(outcome).toMatchObject({ reportId: 'r-1', usedLlm: true });
    const created = prisma.performanceReport.create.mock.calls[0]?.[0].data;
    expect(created.whatWorked).toEqual(['LinkedIn creció 150 seguidores.']);
    expect(created.periodStart).toBeInstanceOf(Date);
    expect(prisma.coachRun.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ job: 'performance' }) }),
    );
  });

  it('sin IA arma el reporte con los números y declara que es plantilla', async () => {
    const { service, prisma } = build({ llmNull: true });

    const outcome = await service.runForProfile('p-1');

    expect(outcome.usedLlm).toBe(false);
    const created = prisma.performanceReport.create.mock.calls[0]?.[0].data;
    expect(created.summary).toContain('plantilla');
    expect(created.summary).toContain('1000 → 1150');
    // La atribución gruesa se declara siempre.
    expect(created.summary).toContain('no por publicación');
    expect(prisma.coachRun.create).not.toHaveBeenCalled();
  });

  it('no avisa una causa que no puede sostener: sin publicaciones lo dice', async () => {
    const { service, prisma } = build({ llmNull: true });
    prisma.contentIdea.findMany.mockResolvedValue([]);

    await service.runForProfile('p-1');

    const created = prisma.performanceReport.create.mock.calls[0]?.[0].data;
    expect(created.whatDidnt.join(' ')).toContain('No se marcó ninguna publicación');
  });

  it('le pasa el gap de objetivos YA CALCULADO al modelo (no lo deja hacer cuentas)', async () => {
    const { service, llm } = build({ objectives: [objectiveFollows()] });

    await service.runForProfile('p-1');

    const prompt = (llm.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].user as string;
    expect(prompt).toContain('Crecimiento y objetivos');
    expect(prompt).toContain('seguidores: 1000 → 1150');
    expect(prompt).toContain('FOLLOWERS: objetivo 5000');
    expect(prompt).toContain('NO llegás');
  });

  it('la plantilla sin IA también dice que no llegás al objetivo', async () => {
    const { service, prisma } = build({ llmNull: true, objectives: [objectiveFollows()] });

    await service.runForProfile('p-1');

    const created = prisma.performanceReport.create.mock.calls[0]?.[0].data;
    // El gap es aritmética: no tiene sentido que la plantilla lo omita.
    expect(created.adjustments.join(' ')).toContain('FOLLOWERS');
  });
});

/** Objetivo de seguidores que los números de prueba NO alcanzan (1000 → 1150 contra 5000). */
function objectiveFollows() {
  return {
    metric: 'FOLLOWERS',
    targetValue: 5000,
    currentValue: null,
    dueDate: new Date(Date.now() + 45 * 86_400_000),
  };
}
