import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service';
import type { NotificationPort } from './notification.port';
import { NotificationsService } from './notifications.service';

/**
 * Los avisos son fail-soft: un canal caído no puede tumbar el pipeline que lo emitió
 * (y el aviso igual tiene que quedar en la bandeja).
 */
function build(channels: NotificationPort[]) {
  const prisma = {
    notification: {
      create: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([{ id: 'n-1' }]),
      count: vi.fn().mockResolvedValue(3),
      findFirst: vi.fn().mockResolvedValue({ id: 'n-1' }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 2 }),
    },
  };
  const logger = { warn: vi.fn(), log: vi.fn(), error: vi.fn(), debug: vi.fn(), verbose: vi.fn(), fatal: vi.fn() };
  const access = { profileWhere: vi.fn().mockReturnValue({ OR: [{ ownerId: 'u-1' }, { ownerId: null }] }) };

  return {
    prisma,
    logger,
    service: new NotificationsService(
      prisma as unknown as PrismaService,
      access as never,
      logger as never,
      channels,
    ),
  };
}

const event = { type: 'IDEAS_READY' as const, title: 'Título', body: 'Cuerpo', profileId: 'p-1' };

describe('NotificationsService.notify', () => {
  it('manda el aviso a todos los canales activos', async () => {
    const a: NotificationPort = { channel: 'dashboard', send: vi.fn().mockResolvedValue(undefined) };
    const b: NotificationPort = { channel: 'discord', send: vi.fn().mockResolvedValue(undefined) };
    const { service } = build([a, b]);

    await service.notify(event);

    expect(a.send).toHaveBeenCalledWith(event);
    expect(b.send).toHaveBeenCalledWith(event);
  });

  it('si un canal falla, los demás igual reciben el aviso (y se registra)', async () => {
    const caido: NotificationPort = { channel: 'whatsapp', send: vi.fn().mockRejectedValue(new Error('sin red')) };
    const ok: NotificationPort = { channel: 'dashboard', send: vi.fn().mockResolvedValue(undefined) };
    const { service, logger } = build([caido, ok]);

    await expect(service.notify(event)).resolves.toBeUndefined();

    expect(ok.send).toHaveBeenCalledWith(event);
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('sin canales no rompe (la bandeja puede estar deshabilitada)', async () => {
    const { service } = build([]);
    await expect(service.notify(event)).resolves.toBeUndefined();
  });
});

describe('NotificationsService (bandeja)', () => {
  it('lista los avisos alcanzables y cuenta los sin leer', async () => {
    const { service, prisma } = build([]);

    const result = await service.list({ sub: 'u-1' }, false);

    expect(result.unread).toBe(3);
    expect(result.count).toBe(1);
    // El alcance sale del AccessScope: propios + los del sistema (sin perfil).
    expect(prisma.notification.findMany.mock.calls[0]?.[0].where.OR).toEqual([
      { profileId: null },
      { profile: { OR: [{ ownerId: 'u-1' }, { ownerId: null }] } },
    ]);
  });

  it('con `unread` filtra solo los no leídos', async () => {
    const { service, prisma } = build([]);

    await service.list({ sub: 'u-1' }, true);

    expect(prisma.notification.findMany.mock.calls[0]?.[0].where.readAt).toBeNull();
  });

  it('marcar uno como leído exige que sea alcanzable', async () => {
    const { service, prisma } = build([]);

    await service.markRead({ sub: 'u-1' }, 'n-1');
    expect(prisma.notification.update).toHaveBeenCalledWith({
      where: { id: 'n-1' },
      data: { readAt: expect.any(Date) },
    });

    prisma.notification.findFirst.mockResolvedValueOnce(null);
    await expect(service.markRead({ sub: 'u-1' }, 'n-ajeno')).rejects.toThrow(/no existe/);
  });

  it('marcar todos devuelve cuántos cambió', async () => {
    const { service } = build([]);
    expect(await service.markAllRead({ sub: 'u-1' })).toBe(2);
  });
});
