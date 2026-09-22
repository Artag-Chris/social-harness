import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service';
import { MetricsService } from './metrics.service';

/**
 * Lo que importa acá es la idempotencia: el snapshot es por cuenta y DÍA, así que
 * reimportar el mismo CSV actualiza. Si duplicara, el reporte de rendimiento contaría
 * el mismo día dos veces y el crecimiento saldría inflado.
 */
function build() {
  const prisma = {
    socialAccount: { findFirst: vi.fn().mockResolvedValue({ id: 'a-1', profileId: 'p-1', platform: 'LINKEDIN', handle: '@x' }) },
    metricSnapshot: {
      upsert: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
  const access = {
    profileWhere: vi.fn().mockReturnValue({ OR: [{ ownerId: 'u-1' }, { ownerId: null }] }),
    assertProfile: vi.fn().mockResolvedValue(undefined),
  };

  return {
    prisma,
    service: new MetricsService(prisma as unknown as PrismaService, access as never),
  };
}

describe('MetricsService.import', () => {
  it('carga un CSV: una fila por día, con upsert por (cuenta, día)', async () => {
    const { service, prisma } = build();

    const result = await service.import({ sub: 'u-1' } as never, 'a-1', {
      csv: 'fecha,seguidores,alcance\n2026-09-01,1000,40000\n2026-09-02,1050,42000\n',
    } as never);

    expect(result.imported).toBe(2);
    expect(prisma.metricSnapshot.upsert).toHaveBeenCalledTimes(2);
    const first = prisma.metricSnapshot.upsert.mock.calls[0]?.[0];
    expect(first.where.socialAccountId_capturedAt).toEqual({
      socialAccountId: 'a-1',
      capturedAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    expect(first.create).toMatchObject({ profileId: 'p-1', followers: 1000, source: 'MANUAL' });
  });

  it('reimportar el mismo día pasa por el update (no duplica)', async () => {
    const { service, prisma } = build();

    await service.import({ sub: 'u-1' } as never, 'a-1', { followers: 1200 } as never);

    expect(prisma.metricSnapshot.upsert.mock.calls[0]?.[0].update).toMatchObject({ followers: 1200 });
  });

  it('sin CSV carga un snapshot suelto del día de hoy', async () => {
    const { service, prisma } = build();

    const result = await service.import({ sub: 'u-1' } as never, 'a-1', {
      followers: 900,
      engagementRate: 3.2,
    } as never);

    expect(result.imported).toBe(1);
    const created = prisma.metricSnapshot.upsert.mock.calls[0]?.[0].create;
    expect(created.followers).toBe(900);
    expect(created.capturedAt.getUTCHours()).toBe(0);
  });

  it('devuelve los avisos del CSV (filas descartadas)', async () => {
    const { service } = build();

    const result = await service.import({ sub: 'u-1' } as never, 'a-1', {
      csv: 'fecha,seguidores\nno-fecha,10\n',
    } as never);

    expect(result.imported).toBe(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('una cuenta ajena da 404 (no se puede cargar métricas de otro)', async () => {
    const { service, prisma } = build();
    prisma.socialAccount.findFirst.mockResolvedValue(null);

    await expect(
      service.import({ sub: 'u-1' } as never, 'a-ajena', { followers: 1 } as never),
    ).rejects.toThrow(/no existe/);
  });
});
