import { describe, expect, it, vi } from 'vitest';
import type { EmbeddingProviderPort } from '../embeddings/embedding-provider.port';
import type { SignalDraft } from '../connectors/signal-draft.schema';
import { IngestionService, toVectorLiteral } from './ingestion.service';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * La ingestión es la que garantiza que reintentar una corrida no duplique nada y
 * que un duplicado no se analice dos veces (ahorra IA). Se prueba con un Prisma
 * falso para poder afirmar QUÉ se llamó, sin base.
 */
function build(subscribers: string[] = ['p-1']) {
  const prisma = {
    signal: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 's-1' }),
    },
    profileSource: { findMany: vi.fn().mockResolvedValue(subscribers.map((profileId) => ({ profileId }))) },
    profileSignal: { createMany: vi.fn().mockResolvedValue({ count: subscribers.length }) },
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
  const embeddings: EmbeddingProviderPort = {
    name: 'mock',
    model: 'mock',
    dimensions: 2,
    isMock: true,
    embed: vi.fn().mockResolvedValue([[0.1, 0.2]]),
  };

  return {
    prisma,
    embeddings,
    service: new IngestionService(prisma as unknown as PrismaService, embeddings),
  };
}

function draft(overrides: Partial<SignalDraft> = {}): SignalDraft {
  return {
    kind: 'NEWS',
    url: 'https://ejemplo.com/nota',
    title: 'Un título suficientemente largo como para agrupar',
    author: 'Equipo',
    keywords: [],
    metrics: {},
    raw: {},
    ...overrides,
  } as SignalDraft;
}

describe('IngestionService', () => {
  it('crea la señal, guarda el embedding y la reparte a los perfiles suscritos', async () => {
    const { service, prisma, embeddings } = build(['p-1', 'p-2']);

    const summary = await service.ingest('src-1', [draft()]);

    expect(summary).toMatchObject({ created: 1, alreadyKnown: 0, profileSignals: 2 });
    expect(prisma.signal.create).toHaveBeenCalledTimes(1);
    expect(embeddings.embed).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma.profileSignal.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: [{ signalId: 's-1', profileId: 'p-1' }, { signalId: 's-1', profileId: 'p-2' }] }),
    );
  });

  it('NO duplica si la misma URL canónica ya estaba (aunque cambien los parámetros)', async () => {
    const { service, prisma } = build();
    prisma.signal.findUnique.mockResolvedValue({ id: 'existente' });

    const summary = await service.ingest('src-1', [
      draft({ url: 'https://ejemplo.com/nota?utm_source=otro&utm_campaign=x' }),
    ]);

    expect(summary.alreadyKnown).toBe(1);
    expect(summary.created).toBe(0);
    expect(prisma.signal.create).not.toHaveBeenCalled();
  });

  it('si el mismo item viene dos veces en el lote, entra una sola vez', async () => {
    const { service, prisma } = build();

    const summary = await service.ingest('src-1', [
      draft({ url: 'https://ejemplo.com/a?utm_source=feed' }),
      draft({ url: 'https://ejemplo.com/a' }),
    ]);

    expect(summary.created).toBe(1);
    expect(summary.alreadyKnown).toBe(1);
    expect(prisma.signal.create).toHaveBeenCalledTimes(1);
  });

  it('marca el duplicado de contenido (mismo título y autor, otra URL) y NO lo reparte', async () => {
    const { service, prisma } = build(['p-1']);
    prisma.signal.findFirst.mockResolvedValue({ id: 'original' });

    const summary = await service.ingest('src-1', [draft({ url: 'https://otromedio.com/la-misma-nota' })]);

    expect(summary.markedAsDuplicate).toBe(1);
    expect(prisma.signal.create.mock.calls[0]?.[0].data.duplicateOfId).toBe('original');
    // Analizar el duplicado costaría IA por nada: el perfil ya tiene el original.
    expect(prisma.profileSignal.createMany).not.toHaveBeenCalled();
  });

  it('descarta los items que no cumplen el contrato (y lo cuenta)', async () => {
    const { service, prisma } = build();

    const summary = await service.ingest('src-1', [
      draft({ url: 'no-es-una-url' }),
      draft({ url: 'https://ejemplo.com/ok' }),
    ]);

    expect(summary.invalid).toBe(1);
    expect(summary.created).toBe(1);
  });

  it('si el embedding falla, la señal igual entra (y el fallo se reporta)', async () => {
    const { service, embeddings, prisma } = build();
    (embeddings.embed as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('sin créditos'));

    const summary = await service.ingest('src-1', [draft()]);

    expect(summary.created).toBe(1);
    expect(summary.embeddingFailures).toBe(1);
    expect(summary.firstEmbeddingError).toContain('sin créditos');
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('sin perfiles suscritos no reparte nada (pero guarda la señal)', async () => {
    const { service, prisma } = build([]);

    const summary = await service.ingest('src-1', [draft()]);

    expect(summary.created).toBe(1);
    expect(summary.profileSignals).toBe(0);
    expect(prisma.profileSignal.createMany).not.toHaveBeenCalled();
  });

  it('si otro worker creó la señal en paralelo (P2002), se cuenta como ya conocida', async () => {
    // Carrera real: dos fuentes que comparten una URL se recolectan en paralelo y
    // las dos pasan el `findUnique`. La que pierde choca contra el índice único y
    // NO puede tumbar la corrida.
    const { service, prisma } = build();
    prisma.signal.create.mockRejectedValue({ code: 'P2002' });

    const summary = await service.ingest('src-1', [draft()]);

    expect(summary.alreadyKnown).toBe(1);
    expect(summary.created).toBe(0);
    // El fan-out lo hizo el worker que ganó la carrera.
    expect(prisma.profileSignal.createMany).not.toHaveBeenCalled();
  });

  it('un error distinto de Prisma sí se propaga (no se traga cualquier fallo)', async () => {
    const { service, prisma } = build();
    prisma.signal.create.mockRejectedValue(new Error('la base se cayó'));

    await expect(service.ingest('src-1', [draft()])).rejects.toThrow('la base se cayó');
  });

  it('un lote vacío no toca la base', async () => {
    const { service, prisma } = build();

    expect(await service.ingest('src-1', [])).toMatchObject({ created: 0 });
    expect(prisma.signal.findUnique).not.toHaveBeenCalled();
  });
});

describe('toVectorLiteral', () => {
  it('arma el literal que entiende pgvector y neutraliza valores raros', () => {
    expect(toVectorLiteral([0.1, 0.2])).toBe('[0.1,0.2]');
    expect(toVectorLiteral([Number.NaN, 1])).toBe('[0,1]');
  });
});
