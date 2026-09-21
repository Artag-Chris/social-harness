import { SourceKind } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service';
import type { TrendConnectorPort } from '../connectors/trend-connector.port';
import { DispatchService } from './dispatch.service';

/**
 * El despacho decide qué se recolecta. Dos reglas que importan:
 *  - una fuente compartida por varios perfiles se descarga UNA vez por ciclo;
 *  - la cadencia del perfil es la MÁS EXIGENTE de sus fuentes (si una pide cada
 *    3 h, no se puede esperar 12).
 */
const HOUR = 60 * 60 * 1000;

function connector(kind: SourceKind, isConfigured = true): TrendConnectorPort {
  return {
    kind,
    label: kind,
    isConfigured,
    fetch: vi.fn(),
  };
}

function source(id: string, kind: SourceKind, intervalHours = 24) {
  return { id, name: `fuente ${id}`, kind, intervalHours, enabled: true };
}

function build(profiles: unknown[], connectors?: Map<string, TrendConnectorPort>) {
  const prisma = {
    profile: {
      findMany: vi.fn().mockResolvedValue(profiles),
      findUnique: vi.fn().mockResolvedValue(profiles[0] ?? null),
      update: vi.fn().mockResolvedValue({}),
    },
  };
  const queue = { add: vi.fn().mockResolvedValue({ id: 'job-1' }) };
  const registry =
    connectors ??
    new Map<string, TrendConnectorPort>([
      [SourceKind.RSS, connector(SourceKind.RSS)],
      [SourceKind.PUBLIC_WEB, connector(SourceKind.PUBLIC_WEB)],
      [SourceKind.YOUTUBE_API, connector(SourceKind.YOUTUBE_API, false)],
    ]);

  return {
    prisma,
    queue,
    service: new DispatchService(prisma as unknown as PrismaService, queue as never, registry as never),
  };
}

describe('DispatchService.runCycle', () => {
  it('encola cada fuente una sola vez aunque la compartan dos perfiles', async () => {
    const shared = source('s-1', SourceKind.RSS);
    const profiles = [
      { id: 'p-1', scheduleHours: 6, sources: [{ intervalHours: null, source: shared }] },
      { id: 'p-2', scheduleHours: 6, sources: [{ intervalHours: null, source: shared }] },
    ];
    const { service, queue } = build(profiles);

    const summary = await service.runCycle();

    expect(summary.profilesConsidered).toBe(2);
    expect(summary.sourcesDispatched).toBe(1);
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add.mock.calls[0]?.[1]).toMatchObject({ sourceId: 's-1' });
  });

  it('la cadencia del perfil es la más exigente de sus fuentes', async () => {
    const profiles = [
      {
        id: 'p-1',
        scheduleHours: 12,
        sources: [
          { intervalHours: null, source: source('s-1', SourceKind.RSS, 24) },
          // Esta selección pide cada 3 h: manda.
          { intervalHours: 3, source: source('s-2', SourceKind.PUBLIC_WEB, 24) },
        ],
      },
    ];
    const { service, prisma } = build(profiles);
    const before = Date.now();

    await service.runCycle();

    const nextRunAt: Date = prisma.profile.update.mock.calls[0]?.[0].data.nextRunAt;
    expect(nextRunAt.getTime() - before).toBeGreaterThanOrEqual(3 * HOUR);
    expect(nextRunAt.getTime() - before).toBeLessThan(4 * HOUR);
  });

  it('saltea las fuentes cuyo conector no está configurado, y lo informa', async () => {
    const profiles = [
      {
        id: 'p-1',
        scheduleHours: 24,
        sources: [
          { intervalHours: null, source: source('s-yt', SourceKind.YOUTUBE_API) },
          { intervalHours: null, source: source('s-rss', SourceKind.RSS) },
        ],
      },
    ];
    const { service, queue } = build(profiles);

    const summary = await service.runCycle();

    expect(summary.sourcesDispatched).toBe(1);
    expect(summary.skipped).toHaveLength(1);
    expect(summary.skipped[0]?.reason).toContain('credenciales');
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('saltea las fuentes cuyo tipo no tiene conector registrado', async () => {
    const profiles = [
      { id: 'p-1', scheduleHours: 24, sources: [{ intervalHours: null, source: source('s-x', SourceKind.RSS) }] },
    ];
    const { service } = build(profiles, new Map());

    const summary = await service.runCycle();

    expect(summary.sourcesDispatched).toBe(0);
    expect(summary.skipped[0]?.reason).toContain('No hay conector');
  });
});

describe('DispatchService.dispatchProfile', () => {
  it('"Buscar ahora" no convierte un perfil manual en automático', async () => {
    const profiles = [
      { id: 'p-1', scheduleHours: null, sources: [{ intervalHours: null, source: source('s-1', SourceKind.RSS) }] },
    ];
    const { service, prisma, queue } = build(profiles);

    const summary = await service.dispatchProfile('p-1');

    expect(summary.sourcesDispatched).toBe(1);
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(prisma.profile.update.mock.calls[0]?.[0].data.nextRunAt).toBeNull();
  });

  it('con cadencia propia, la corrida a mano reprograma el reloj', async () => {
    const profiles = [
      { id: 'p-1', scheduleHours: 6, sources: [{ intervalHours: null, source: source('s-1', SourceKind.RSS) }] },
    ];
    const { service, prisma } = build(profiles);
    const before = Date.now();

    await service.dispatchProfile('p-1');

    const nextRunAt: Date = prisma.profile.update.mock.calls[0]?.[0].data.nextRunAt;
    expect(nextRunAt.getTime() - before).toBeGreaterThanOrEqual(6 * HOUR);
  });
});
