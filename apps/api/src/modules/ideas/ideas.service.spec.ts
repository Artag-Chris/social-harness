import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';
import type { PrismaService } from '../../prisma/prisma.service';
import type { LlmProviderPort } from '../llm/llm-provider.port';
import { IdeasService } from './ideas.service';

/**
 * Las ideas son la salida del coach: lo que se prueba es que cada idea quede atada a
 * señales reales, con un formato que exista en esa red, y que sin IA el calendario no
 * quede vacío (plantilla marcada como tal).
 */
function build(options: { candidates?: unknown[]; alreadyUsed?: string[]; llmNull?: boolean } = {}) {
  const candidates = options.candidates ?? [candidate('s-1', 'inteligencia artificial para pymes')];

  const prisma = {
    profile: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'p-1',
        name: 'Mi marca',
        niche: ['inteligencia artificial'],
        audience: 'pymes',
        voice: 'directo',
        language: 'es',
        ideasPerWeek: 2,
        accounts: [{ platform: 'LINKEDIN' }],
        objectives: [],
      }),
    },
    profileSignal: {
      findMany: vi.fn().mockResolvedValue(candidates),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    ideaSignal: { findMany: vi.fn().mockResolvedValue((options.alreadyUsed ?? []).map((signalId) => ({ signalId }))) },
    contentIdea: {
      create: vi.fn().mockResolvedValue({ id: 'idea-1' }),
      findFirst: vi.fn().mockResolvedValue({ id: 'idea-1' }),
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
              ideas: [
                {
                  title: 'Cómo aplicar IA en una pyme',
                  hook: 'Nadie te dice esto de la IA',
                  angle: 'Contá un caso real con números.',
                  whyNow: 'La tendencia viene subiendo.',
                  platform: 'LINKEDIN',
                  format: 'CAROUSEL',
                  hashtags: ['ia', 'pymes'],
                  bestTimes: [{ day: 'martes', hour: '8 h', reason: 'horario laboral' }],
                  signalIds: ['s-1'],
                },
              ],
            },
            meta: {
              text: '',
              provider: 'deepseek',
              model: 'deepseek-chat',
              usage: { inputTokens: 200, outputTokens: 120, cachedInputTokens: 0 },
              costUsd: 0.0002,
              latencyMs: 1200,
            },
          },
    ),
    isHealthy: vi.fn().mockResolvedValue(true),
  };

  const queue = { add: vi.fn().mockResolvedValue({ id: 'job' }) } as unknown as Queue;
  const notifications = { notify: vi.fn().mockResolvedValue(undefined) };
  const access = { assertProfile: vi.fn().mockResolvedValue(undefined) };
  // La audiencia la produce el coach de comunidad; acá alcanza con que devuelva líneas.
  const community = { segmentsForPrompt: vi.fn().mockResolvedValue([]) };

  return {
    prisma,
    llm,
    community,
    queue: queue as unknown as { add: ReturnType<typeof vi.fn> },
    notifications,
    service: new IdeasService(
      prisma as unknown as PrismaService,
      access as never,
      notifications as never,
      community as never,
      llm,
      queue,
    ),
  };
}

function candidate(signalId: string, title: string) {
  return {
    id: `ps-${signalId}`,
    signalId,
    relevanceScore: 82,
    reasons: ['Toca tu nicho: inteligencia artificial'],
    signal: {
      id: signalId,
      title,
      summary: 'Un resumen de la nota',
      keywords: ['ia'],
      platform: 'LINKEDIN',
      kind: 'NEWS',
    },
  };
}

describe('IdeasService.generateForProfile', () => {
  it('sin señales relevantes no llama a la IA', async () => {
    const { service, prisma } = build({ candidates: [] });

    const outcome = await service.generateForProfile('p-1');

    expect(outcome.created).toBe(0);
    expect(outcome.skipped).toContain('No hay señales con relevancia');
    expect(prisma.coachRun.create).not.toHaveBeenCalled();
  });

  it('con IA: crea la idea atada a la señal, la programa y marca la señal como usada', async () => {
    const { service, prisma, notifications } = build();

    const outcome = await service.generateForProfile('p-1');

    expect(outcome).toMatchObject({ created: 1, usedLlm: true });

    const created = prisma.contentIdea.create.mock.calls[0]?.[0].data;
    expect(created).toMatchObject({ platform: 'LINKEDIN', format: 'CAROUSEL', source: 'ia', status: 'IDEA' });
    expect(created.scheduledFor).toBeInstanceOf(Date);
    expect(created.signals.create).toEqual([
      { signalId: 's-1', contribution: 'Señal que sostiene la idea' },
    ]);

    // La señal queda usada: no se vuelve a proponer en la próxima corrida.
    expect(prisma.profileSignal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'USED' } }),
    );
    expect(prisma.coachRun.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ job: 'ideas' }) }),
    );
    expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'IDEAS_READY' }));
  });

  it('descarta las ideas con formato que no existe en la red', async () => {
    const { service, llm, prisma } = build();
    (llm.json as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        ideas: [
          {
            title: 'Encuesta en LinkedIn',
            hook: 'hook válido',
            angle: 'un ángulo con suficiente texto',
            whyNow: 'porque sí',
            platform: 'LINKEDIN',
            format: 'REEL', // no existe en LinkedIn
            hashtags: [],
            bestTimes: [],
            signalIds: ['s-1'],
          },
        ],
      },
      meta: { text: '', provider: 'x', model: 'x', usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 }, costUsd: 0, latencyMs: 1 },
    });

    const outcome = await service.generateForProfile('p-1');

    expect(outcome.created).toBe(0);
    expect(outcome.rejected).toBe(1);
    expect(prisma.contentIdea.create).not.toHaveBeenCalled();
  });

  it('descarta las ideas que citan señales que no existen', async () => {
    const { service, llm } = build();
    (llm.json as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        ideas: [
          {
            title: 'Idea fantasma',
            hook: 'hook válido',
            angle: 'un ángulo con suficiente texto',
            whyNow: 'porque sí',
            platform: 'LINKEDIN',
            format: 'POST',
            hashtags: [],
            bestTimes: [],
            signalIds: ['no-existe'],
          },
        ],
      },
      meta: { text: '', provider: 'x', model: 'x', usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 }, costUsd: 0, latencyMs: 1 },
    });

    const outcome = await service.generateForProfile('p-1');

    expect(outcome.rejected).toBe(1);
    expect(outcome.created).toBe(0);
  });

  it('sin IA: arma la idea con plantilla y la marca como tal', async () => {
    const { service, prisma } = build({ llmNull: true });

    const outcome = await service.generateForProfile('p-1');

    expect(outcome).toMatchObject({ created: 1, usedLlm: false });
    const created = prisma.contentIdea.create.mock.calls[0]?.[0].data;
    expect(created.source).toBe('plantilla');
    expect(created.whyNow).toContain('82/100');
    expect(created.signals.create).toEqual([
      { signalId: 's-1', contribution: 'Señal que sostiene la idea' },
    ]);
  });

  it('no repite señales que ya sostienen otra idea', async () => {
    const { service, prisma } = build({ alreadyUsed: ['s-1'] });

    const outcome = await service.generateForProfile('p-1');

    expect(outcome.skipped).toContain('ya están usadas');
    expect(prisma.contentIdea.create).not.toHaveBeenCalled();
  });
});

describe('IdeasService.create (a mano)', () => {
  it('valida que el formato exista en la red', async () => {
    const { service } = build();

    await expect(
      service.create({ sub: 'u' } as never, {
        profileId: 'p-1',
        platform: 'INSTAGRAM',
        format: 'POLL',
        title: 'Una idea',
        hook: 'hook',
        angle: 'angle',
        whyNow: 'why',
        hashtags: [],
      } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('guarda la idea marcada como manual', async () => {
    const { service, prisma } = build();

    await service.create({ sub: 'u' } as never, {
      profileId: 'p-1',
      platform: 'LINKEDIN',
      format: 'POST',
      title: 'Una idea',
      hook: 'hook',
      angle: 'angle',
      whyNow: 'why',
      hashtags: ['ia'],
    } as never);

    expect(prisma.contentIdea.create.mock.calls[0]?.[0].data.source).toBe('manual');
  });
});
