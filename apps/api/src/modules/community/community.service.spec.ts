import { describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';
import type { PrismaService } from '../../prisma/prisma.service';
import type { LlmProviderPort } from '../llm/llm-provider.port';
import { formatSegmentsForPrompt } from './community.prompt';
import { CommunityService } from './community.service';

/**
 * Las reglas que se prueban acá son las de convivencia entre el humano y la IA:
 *
 *  1. Sin materia prima (nicho o audiencia declarada) NO se llama a la IA ni se inventa una
 *     audiencia: se avisa qué falta.
 *  2. Sin proveedor de IA, la propuesta sale como `plantilla` (declarada, no disfrazada).
 *  3. Lo que toca el humano queda `manual` y la propuesta siguiente no lo pisa.
 *  4. El gasto de la llamada se registra.
 */

const PROFILE = {
  id: 'p-1',
  name: 'Mi marca',
  niche: ['ia'],
  audience: 'pymes que quieren aplicar IA',
  voice: 'directo',
  language: 'es',
  objectives: [{ metric: 'FOLLOWERS', targetValue: 5000 }],
};

function build(options: { llmNull?: boolean; profile?: unknown; segments?: unknown[] } = {}) {
  const profile = options.profile === undefined ? PROFILE : options.profile;

  const prisma = {
    profile: { findUnique: vi.fn().mockResolvedValue(profile) },
    profileSignal: {
      findMany: vi.fn().mockResolvedValue([{ relevanceScore: 90, signal: { title: 'Señal top' } }]),
    },
    contentIdea: {
      findMany: vi.fn().mockResolvedValue([{ title: 'Idea publicada', platform: 'LINKEDIN' }]),
    },
    audienceSegment: {
      findMany: vi.fn().mockResolvedValue(options.segments ?? []),
      findFirst: vi.fn().mockResolvedValue({ id: 's-1' }),
      upsert: vi.fn().mockImplementation((args: { create: unknown }) => Promise.resolve(args.create)),
      update: vi.fn().mockImplementation((args: { data: unknown }) => Promise.resolve(args.data)),
      updateMany: vi.fn().mockResolvedValue({ count: 2 }),
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
              segments: [
                {
                  name: 'Dueño de pyme que hace todo solo',
                  description: 'Sin equipo de marketing: publica cuando le queda tiempo.',
                  pains: ['no tiene tiempo'],
                  desires: ['delegar sin contratar'],
                  objections: ['probó herramientas y las abandonó'],
                  channels: ['r/pequenasempresas', '#pymes'],
                  languageTips: 'habla de plata y de tiempo, no de tecnología',
                  basedOn: ['la señal top', 'lo que ya publicó'],
                },
              ],
            },
            meta: {
              text: '',
              provider: 'deepseek',
              model: 'deepseek-chat',
              usage: { inputTokens: 900, outputTokens: 500, cachedInputTokens: 0 },
              costUsd: 0.0005,
              latencyMs: 8000,
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
    queue,
    service: new CommunityService(
      prisma as unknown as PrismaService,
      access as never,
      notifications as never,
      llm,
      queue,
    ),
  };
}

describe('CommunityService: propuesta de audiencia', () => {
  it('sin nicho ni audiencia declarada no gasta IA y dice qué falta', async () => {
    const { service, llm, prisma, notifications } = build({
      profile: { ...PROFILE, niche: [], audience: null },
    });

    const outcome = await service.runPropose('p-1');

    expect(outcome).toMatchObject({ created: 0, usedLlm: false });
    expect(outcome.skipped).toContain('nicho ni audiencia');
    expect(llm.json).not.toHaveBeenCalled();
    expect(prisma.audienceSegment.upsert).not.toHaveBeenCalled();
    expect(notifications.notify).toHaveBeenCalled();
  });

  it('con IA guarda los segmentos y registra el gasto', async () => {
    const { service, prisma } = build();

    const outcome = await service.runPropose('p-1');

    expect(outcome).toMatchObject({ created: 1, usedLlm: true });
    const created = prisma.audienceSegment.upsert.mock.calls[0]?.[0].create;
    expect(created.source).toBe('ia');
    expect(created.name).toBe('Dueño de pyme que hace todo solo');
    expect(created.channels).toContain('r/pequenasempresas');
    // `evidence` guarda de qué se basó: es lo que hace auditable la propuesta.
    expect(created.evidence).toEqual(['la señal top', 'lo que ya publicó']);
    expect(prisma.coachRun.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ job: 'community-segments' }) }),
    );
  });

  it('sin IA la propuesta sale marcada como plantilla (y sale de lo que el perfil ya dijo)', async () => {
    const { service, prisma } = build({ llmNull: true });

    const outcome = await service.runPropose('p-1');

    expect(outcome).toMatchObject({ created: 1, usedLlm: false });
    const created = prisma.audienceSegment.upsert.mock.calls[0]?.[0].create;
    expect(created.source).toBe('plantilla');
    expect(created.description).toContain('pymes');
    expect(prisma.coachRun.create).not.toHaveBeenCalled();
  });

  it('archiva los segmentos anteriores de la IA, pero NUNCA los del humano', async () => {
    const { service, prisma } = build();

    const outcome = await service.runPropose('p-1');

    expect(outcome.archived).toBe(2);
    // El filtro es la clave: solo `ia` y `plantilla`. Un segmento `manual` queda intacto.
    expect(prisma.audienceSegment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ source: { in: ['ia', 'plantilla'] } }),
      }),
    );
  });

  it('un segmento que el humano corrige no vuelve a figurar como de la IA', async () => {
    const { service, prisma } = build();

    await service.patchSegment({ sub: 'u-1' } as never, 'p-1', 's-1', { description: 'lo mío' });

    const data = prisma.audienceSegment.update.mock.calls[0]?.[0].data;
    expect(data.source).toBe('manual');
    expect(data.description).toBe('lo mío');
  });

  it('archivar es una decisión del humano y se respeta', async () => {
    const { service, prisma } = build();

    await service.patchSegment({ sub: 'u-1' } as never, 'p-1', 's-1', { archived: true });

    const data = prisma.audienceSegment.update.mock.calls[0]?.[0].data;
    expect(data.archivedAt).toBeInstanceOf(Date);
  });

  it('no se puede tocar un segmento de otro perfil', async () => {
    const { service, prisma } = build();
    prisma.audienceSegment.findFirst.mockResolvedValue(null);

    await expect(
      service.patchSegment({ sub: 'u-1' } as never, 'p-1', 'ajeno', { description: 'x' }),
    ).rejects.toThrow('no existe');
  });

  it('el pedido manual encola el trabajo (y cada clic corre)', async () => {
    const { service, queue } = build();

    await service.requestPropose('p-1');

    expect(queue.add).toHaveBeenCalledWith('segments-propose', { profileId: 'p-1' }, expect.anything());
  });
});

describe('formatSegmentsForPrompt', () => {
  it('deja los segmentos en texto para los otros prompts', () => {
    const lines = formatSegmentsForPrompt([
      {
        name: 'Dueño de pyme',
        description: 'Hace todo solo.',
        pains: ['no tiene tiempo'],
        desires: ['delegar'],
        objections: ['probó y abandonó'],
        languageTips: 'habla de plata',
      },
    ]);

    const text = lines.join('\n');
    expect(text).toContain('Dueño de pyme: Hace todo solo.');
    expect(text).toContain('le duele: no tiene tiempo');
    expect(text).toContain('no te sigue porque: probó y abandonó');
    expect(text).toContain('cómo le habla: habla de plata');
  });

  it('un segmento sin dolores cargados no inventa la línea', () => {
    const lines = formatSegmentsForPrompt([
      {
        name: 'Segmento',
        description: 'Descripción.',
        pains: [],
        desires: [],
        objections: [],
        languageTips: null,
      },
    ]);

    expect(lines[0]).toBe('- Segmento: Descripción.');
  });
});
