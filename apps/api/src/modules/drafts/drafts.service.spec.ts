import { describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';
import type { PrismaService } from '../../prisma/prisma.service';
import type { LlmProviderPort } from '../llm/llm-provider.port';
import { DraftsService } from './drafts.service';

/**
 * Los borradores son la regla más fuerte del proyecto: se generan SOLO a demanda. Lo
 * que se prueba es que nada los dispare solo, que regenerar no pise lo editado y que
 * sin IA el borrador quede marcado como plantilla.
 */
function build(options: { llmNull?: boolean; previousVersion?: number } = {}) {
  const prisma = {
    contentIdea: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'i-1',
        profileId: 'p-1',
        title: 'Cómo aplicar IA en una pyme',
        hook: 'Nadie te dice esto',
        angle: 'Contá un caso real con números.',
        whyNow: 'La tendencia sube.',
        platform: 'LINKEDIN',
        format: 'POST',
        hashtags: ['ia'],
        status: 'IDEA',
        profile: {
          name: 'Mi marca',
          niche: ['ia'],
          audience: 'pymes',
          voice: 'directo',
          language: 'es',
          accounts: [{ platform: 'LINKEDIN' }],
        },
        signals: [
          {
            signal: {
              title: 'Nota sobre IA',
              summary: 'Un resumen',
              canonicalUrl: 'https://ejemplo.com/nota',
              url: 'https://ejemplo.com/nota?utm_source=x',
            },
          },
        ],
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    contentDraft: {
      findFirst: vi.fn().mockResolvedValue(options.previousVersion ? { version: options.previousVersion } : null),
      create: vi.fn().mockResolvedValue({ id: 'd-1', version: (options.previousVersion ?? 0) + 1 }),
      findFirstForGet: vi.fn(),
      update: vi.fn().mockResolvedValue({ id: 'd-1' }),
    },
    coachRun: { create: vi.fn().mockResolvedValue({}) },
  };
  // `get()` usa el mismo findFirst: se resuelve por separado en el test que lo necesita.
  prisma.contentDraft.findFirst = vi.fn().mockImplementation((args: { orderBy?: unknown }) =>
    Promise.resolve(args?.orderBy ? (options.previousVersion ? { version: options.previousVersion } : null) : { id: 'd-1' }),
  );

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
              caption: 'Pasamos de 4 horas diarias de respuestas a 20 minutos de revisión.',
              script: '',
              hookVariants: ['Nadie te dice esto de la IA'],
              cta: 'Te cuento el detalle en comentarios.',
              notes: 'Usar el caso propio.',
            },
            meta: {
              text: '',
              provider: 'deepseek',
              model: 'deepseek-chat',
              usage: { inputTokens: 400, outputTokens: 300, cachedInputTokens: 0 },
              costUsd: 0.0003,
              latencyMs: 5000,
            },
          },
    ),
    isHealthy: vi.fn().mockResolvedValue(true),
  };

  const queue = { add: vi.fn().mockResolvedValue({ id: 'job' }) } as unknown as Queue;
  const access = { profileWhere: vi.fn().mockReturnValue({ OR: [] }) };
  // La audiencia la produce el coach de comunidad: acá solo importa que llegue al prompt.
  const community = { segmentsForPrompt: vi.fn().mockResolvedValue([]) };

  return {
    prisma,
    community,
    queue: queue as unknown as { add: ReturnType<typeof vi.fn> },
    service: new DraftsService(
      prisma as unknown as PrismaService,
      access as never,
      community as never,
      llm,
      queue,
    ),
  };
}

describe('DraftsService', () => {
  it('guarda el borrador del modelo y registra el gasto', async () => {
    const { service, prisma } = build();

    const outcome = await service.generateForIdea('i-1');

    expect(outcome).toMatchObject({ draftId: 'd-1', version: 1, usedLlm: true });
    const created = prisma.contentDraft.create.mock.calls[0]?.[0].data;
    expect(created.content.caption).toContain('4 horas');
    expect(created.editedByUser).toBeUndefined();
    expect(prisma.coachRun.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ job: 'draft', tokensIn: 400 }) }),
    );
  });

  it('regenerar crea una versión nueva (no pisa la anterior)', async () => {
    const { service, prisma } = build({ previousVersion: 1 });

    const outcome = await service.generateForIdea('i-1');

    expect(outcome.version).toBe(2);
    expect(prisma.contentDraft.create.mock.calls[0]?.[0].data.version).toBe(2);
  });

  it('sin IA arma el borrador con plantilla y lo dice', async () => {
    const { service, prisma } = build({ llmNull: true });

    const outcome = await service.generateForIdea('i-1');

    expect(outcome.usedLlm).toBe(false);
    const content = prisma.contentDraft.create.mock.calls[0]?.[0].data.content;
    expect(content.notes).toContain('plantilla');
    expect(content.caption).toContain('Nadie te dice esto');
    // No se registra gasto si no hubo llamada.
    expect(prisma.coachRun.create).not.toHaveBeenCalled();
  });

  it('si la idea no existe, sale con motivo', async () => {
    const { service, prisma } = build();
    prisma.contentIdea.findUnique.mockResolvedValue(null);

    const outcome = await service.generateForIdea('i-x');

    expect(outcome.skipped).toContain('no existe');
  });

  it('editar marca `editedByUser` (una regeneración después no lo pisa)', async () => {
    const { service, prisma } = build();

    await service.update({ sub: 'u-1' } as never, 'd-1', {
      caption: 'Texto reescrito por la persona',
      script: '',
      hookVariants: [],
      cta: '',
      notes: '',
    } as never);

    expect(prisma.contentDraft.update.mock.calls[0]?.[0].data.editedByUser).toBe(true);
  });

  it('el pedido a demanda no deduplica: cada clic encola su trabajo', async () => {
    const { service, queue } = build();

    await service.requestGeneration('i-1');
    await service.requestGeneration('i-1');

    expect(queue.add).toHaveBeenCalledTimes(2);
    // Sin `jobId`: un id derivado del reloj hacía que dos clics en el mismo
    // milisegundo se pisaran y BullMQ ignorara el segundo.
    expect(queue.add.mock.calls[0]?.[2]?.jobId).toBeUndefined();
    expect(queue.add.mock.calls[0]?.[1]).toEqual({ ideaId: 'i-1' });
  });
});
