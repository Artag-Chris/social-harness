import { describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';
import type { PrismaService } from '../../prisma/prisma.service';
import type { LlmProviderPort } from '../llm/llm-provider.port';
import { AnalysisService } from './analysis.service';

/**
 * El análisis es donde se gasta la IA, así que lo que se prueba es el control:
 * una sola llamada por perfil, nada si no hay señales nuevas, y respaldo
 * determinístico si el proveedor no está.
 */
function build(options: { pending?: unknown[]; llmNull?: boolean; autoIdeas?: boolean } = {}) {
  const pending = options.pending ?? [row('s-1', 'inteligencia artificial para pymes')];

  const prisma = {
    profile: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'p-1',
        name: 'Mi marca',
        niche: ['inteligencia artificial'],
        audience: null,
        voice: null,
        autoIdeasEnabled: options.autoIdeas ?? true,
        accounts: [{ platform: 'LINKEDIN' }],
        objectives: [],
      }),
    },
    profileSignal: { findMany: vi.fn().mockResolvedValue(pending), update: vi.fn().mockResolvedValue({}) },
    signal: { update: vi.fn().mockResolvedValue({}) },
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
            data: { results: [{ signalId: 's-1', score: 88, reasons: ['el modelo dice que sí'] }] },
            meta: {
              text: '',
              provider: 'deepseek',
              model: 'deepseek-chat',
              usage: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 0 },
              costUsd: 0.0001,
              latencyMs: 900,
            },
          },
    ),
    isHealthy: vi.fn().mockResolvedValue(true),
  };

  const queue = { add: vi.fn().mockResolvedValue({ id: 'job' }) } as unknown as Queue;
  const notifications = { notify: vi.fn().mockResolvedValue(undefined) };

  return {
    prisma,
    llm,
    queue: queue as unknown as { add: ReturnType<typeof vi.fn> },
    notifications,
    service: new AnalysisService(
      prisma as unknown as PrismaService,
      llm,
      notifications as never,
      queue,
    ),
  };
}

function row(signalId: string, title: string, score = 0) {
  return {
    id: `ps-${signalId}`,
    signalId,
    relevanceScore: score,
    reasons: [],
    signal: {
      id: signalId,
      title,
      summary: null,
      keywords: [],
      platform: 'LINKEDIN',
      kind: 'NEWS',
      publishedAt: new Date(),
      createdAt: new Date(),
      metrics: {},
    },
  };
}

describe('AnalysisService', () => {
  it('sin señales nuevas no llama a la IA (no gasta nada)', async () => {
    const { service, llm, prisma } = build({ pending: [] });

    const outcome = await service.analyzeProfile('p-1');

    expect(outcome.analyzed).toBe(0);
    expect(outcome.skipped).toContain('No hay señales nuevas');
    expect(llm.json).not.toHaveBeenCalled();
    expect(prisma.coachRun.create).not.toHaveBeenCalled();
  });

  it('con IA: guarda el score del modelo, marca la señal y registra el gasto', async () => {
    const { service, prisma, llm } = build();

    const outcome = await service.analyzeProfile('p-1');

    expect(llm.json).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ analyzed: 1, usedLlm: true, topScore: 88 });

    const update = prisma.profileSignal.update.mock.calls[0]?.[0];
    expect(update.data.relevanceScore).toBe(88);
    expect(update.data.reasons).toEqual(['el modelo dice que sí']);
    expect(update.data.scoredAt).toBeInstanceOf(Date);

    // La marca de "ya juzgada" es lo que evita volver a pagar por ella.
    expect(prisma.signal.update).toHaveBeenCalledWith({
      where: { id: 's-1' },
      data: { status: 'ANALYZED' },
    });
    expect(prisma.coachRun.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ job: 'analyze', tokensIn: 100 }) }),
    );
  });

  it('sin IA (mock): queda el score determinístico y no se registra gasto', async () => {
    const { service, prisma } = build({ llmNull: true });

    const outcome = await service.analyzeProfile('p-1');

    expect(outcome.usedLlm).toBe(false);
    expect(outcome.topScore).toBeGreaterThan(0);
    expect(prisma.coachRun.create).not.toHaveBeenCalled();
    expect(prisma.profileSignal.update.mock.calls[0]?.[0].data.reasons.join(' ')).toContain('nicho');
  });

  it('si el modelo devuelve un id que no existe, se ignora ese juicio', async () => {
    const { service, prisma, llm } = build();
    (llm.json as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { results: [{ signalId: 'inventado', score: 99, reasons: ['no existe'] }] },
      meta: { text: '', provider: 'x', model: 'x', usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 }, costUsd: 0, latencyMs: 1 },
    });

    const outcome = await service.analyzeProfile('p-1');

    // El score determinístico se mantiene: nunca queda en 0 por un olvido del modelo.
    expect(outcome.topScore).not.toBe(99);
    expect(prisma.profileSignal.update.mock.calls[0]?.[0].data.reasons.join(' ')).toContain('nicho');
  });

  it('si pasa el umbral y las ideas están prendidas, se encolan', async () => {
    const { service, queue } = build();

    const outcome = await service.analyzeProfile('p-1');

    expect(outcome.ideasEnqueued).toBe(true);
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('con las ideas apagadas por perfil, no se encola nada (control de costo)', async () => {
    const { service, queue } = build({ autoIdeas: false });

    const outcome = await service.analyzeProfile('p-1');

    expect(outcome.ideasEnqueued).toBe(false);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('avisa al perfil lo que pasó (y no rompe si el aviso falla)', async () => {
    const { service, notifications } = build();
    notifications.notify.mockRejectedValueOnce(new Error('canal caído'));

    await expect(service.analyzeProfile('p-1')).resolves.toBeDefined();
    expect(notifications.notify).toHaveBeenCalled();
  });

  it('si el perfil no existe, sale con motivo en vez de fallar', async () => {
    const { service, prisma } = build();
    prisma.profile.findUnique.mockResolvedValue(null);

    const outcome = await service.analyzeProfile('p-x');

    expect(outcome.skipped).toContain('no existe');
  });
});
