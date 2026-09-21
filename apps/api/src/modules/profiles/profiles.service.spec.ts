import { ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service';
import { AccessScope } from '../auth/access-scope.service';
import type { AuthPayload } from '../auth/auth.types';
import { ProfilesService } from './profiles.service';

const user: AuthPayload = { sub: 'u-1', businessId: 'biz-1', role: 'ADMIN' };

/** Prisma mínimo: solo lo que usa el servicio, con las llamadas espiadas. */
function build() {
  const prisma = {
    profile: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue({ id: 'p-1' }),
      findFirstOrThrow: vi.fn().mockResolvedValue({ id: 'p-1' }),
      findUnique: vi.fn().mockResolvedValue({ scheduleHours: 24 }),
      create: vi.fn().mockResolvedValue({ id: 'p-1' }),
      update: vi.fn().mockResolvedValue({ id: 'p-1' }),
      delete: vi.fn().mockResolvedValue({ id: 'p-1' }),
    },
    socialAccount: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue({ id: 'a-1' }),
      create: vi.fn().mockResolvedValue({ id: 'a-1' }),
      update: vi.fn().mockResolvedValue({ id: 'a-1' }),
      delete: vi.fn().mockResolvedValue({ id: 'a-1' }),
    },
    objective: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue({ id: 'o-1' }),
      create: vi.fn().mockResolvedValue({ id: 'o-1' }),
      update: vi.fn().mockResolvedValue({ id: 'o-1' }),
      delete: vi.fn().mockResolvedValue({ id: 'o-1' }),
    },
    profileSource: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      upsert: vi.fn().mockResolvedValue({ id: 'ps-1' }),
      findUnique: vi.fn().mockResolvedValue({ profileId: 'p-1', sourceId: 's-1' }),
      update: vi.fn().mockResolvedValue({ id: 'ps-1' }),
      delete: vi.fn().mockResolvedValue({ id: 'ps-1' }),
    },
    source: { findMany: vi.fn().mockResolvedValue([{ id: 's-1' }, { id: 's-2' }]) },
    // Las operaciones llegan como promesas ya armadas; el fake solo las espera.
    $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
  };

  const prismaService = prisma as unknown as PrismaService;
  return { prisma, service: new ProfilesService(prismaService, new AccessScope(prismaService)) };
}

describe('ProfilesService', () => {
  let context: ReturnType<typeof build>;

  beforeEach(() => {
    context = build();
  });

  it('al crear sella el dueño con el token y arma la próxima corrida', async () => {
    await context.service.create(user, { name: 'Mi marca', niche: [], language: 'es', scheduleHours: 6, ideasPerWeek: 3, autoIdeasEnabled: true });

    const data = context.prisma.profile.create.mock.calls[0]?.[0].data;
    expect(data.ownerId).toBe('u-1');
    expect(data.businessId).toBe('biz-1');
    expect(data.nextRunAt).toBeInstanceOf(Date);
  });

  it('con cadencia null, el perfil queda sin corrida automática', async () => {
    await context.service.create(user, {
      name: 'Sin cadencia',
      niche: [],
      language: 'es',
      scheduleHours: null,
      ideasPerWeek: 3,
      autoIdeasEnabled: true,
    });

    expect(context.prisma.profile.create.mock.calls[0]?.[0].data.nextRunAt).toBeNull();
  });

  it('lista y detalle usan el filtro de alcance (nunca un id suelto)', async () => {
    await context.service.list(user);
    expect(context.prisma.profile.findMany.mock.calls[0]?.[0].where).toEqual({
      OR: [{ ownerId: 'u-1' }, { ownerId: null }],
    });

    await context.service.get(user, 'p-1');
    expect(context.prisma.profile.findFirstOrThrow.mock.calls[0]?.[0].where).toEqual({
      id: 'p-1',
      OR: [{ ownerId: 'u-1' }, { ownerId: null }],
    });
  });

  it('agregar una cuenta repetida devuelve 409 (no un 500 de Prisma)', async () => {
    context.prisma.socialAccount.create.mockRejectedValueOnce({ code: 'P2002' });

    await expect(
      context.service.addAccount(user, 'p-1', { platform: 'LINKEDIN', handle: '/in/mi-marca' }),
    ).rejects.toThrow(ConflictException);
  });

  it('quitar una red borra esa fila (y avisa si no existe)', async () => {
    await context.service.removeAccount(user, 'p-1', 'a-1');
    expect(context.prisma.socialAccount.delete).toHaveBeenCalledWith({ where: { id: 'a-1' } });

    context.prisma.socialAccount.findFirst.mockResolvedValueOnce(null);
    await expect(context.service.removeAccount(user, 'p-1', 'a-inexistente')).rejects.toThrow(
      /no existe/,
    );
  });

  it('reemplazar fuentes: quita las que sobran, agrega las nuevas y rearma la corrida', async () => {
    await context.service.setSources(user, 'p-1', ['s-1', 's-2']);

    expect(context.prisma.profileSource.deleteMany.mock.calls[0]?.[0].where).toEqual({
      profileId: 'p-1',
      sourceId: { notIn: ['s-1', 's-2'] },
    });
    expect(context.prisma.profileSource.upsert).toHaveBeenCalledTimes(2);
    expect(context.prisma.profile.update.mock.calls[0]?.[0].data.nextRunAt).toBeInstanceOf(Date);
  });

  it('reemplazar fuentes valida que existan y avisa cuáles faltan', async () => {
    context.prisma.source.findMany.mockResolvedValueOnce([{ id: 's-1' }]);

    await expect(context.service.setSources(user, 'p-1', ['s-1', 's-fantasma'])).rejects.toThrow(
      /s-fantasma/,
    );
  });

  it('con la lista vacía quita todas las selecciones (sin mandar un notIn vacío)', async () => {
    await context.service.setSources(user, 'p-1', []);

    expect(context.prisma.profileSource.deleteMany.mock.calls[0]?.[0].where.sourceId).toEqual({
      notIn: ['__ninguna__'],
    });
    expect(context.prisma.profileSource.upsert).not.toHaveBeenCalled();
  });

  it('cambiar la cadencia recalcula la corrida; editar otro campo no la toca', async () => {
    await context.service.update(user, 'p-1', { scheduleHours: 12 });
    expect(context.prisma.profile.update.mock.calls[0]?.[0].data.nextRunAt).toBeInstanceOf(Date);

    context.prisma.profile.update.mockClear();
    await context.service.update(user, 'p-1', { name: 'Otro nombre' });
    expect(context.prisma.profile.update.mock.calls[0]?.[0].data).not.toHaveProperty('nextRunAt');
  });
});
