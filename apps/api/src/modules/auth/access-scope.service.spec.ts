import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service';
import { AccessScope } from './access-scope.service';
import type { AuthPayload } from './auth.types';

function scopeWith(findFirst = vi.fn()): { scope: AccessScope; findFirst: ReturnType<typeof vi.fn> } {
  const prisma = { profile: { findFirst } } as unknown as PrismaService;
  return { scope: new AccessScope(prisma), findFirst };
}

const user: AuthPayload = { sub: 'u-1', businessId: 'biz-1', role: 'ADMIN' };

/**
 * El aislamiento es lo que evita que un usuario vea o toque datos de otro. Se
 * prueba que el filtro salga del `sub` del token y que el dueño se selle con él.
 */
describe('AccessScope', () => {
  it('un usuario común solo alcanza lo suyo (y lo que no tiene dueño, del seed)', () => {
    const { scope } = scopeWith();

    expect(scope.profileWhere(user)).toEqual({
      OR: [{ ownerId: 'u-1' }, { ownerId: null }],
    });
  });

  it('SUPER_ADMIN ve todo (sin filtro)', () => {
    const { scope } = scopeWith();

    expect(scope.profileWhere({ ...user, role: 'SUPER_ADMIN' })).toEqual({});
    expect(scope.isGlobal({ ...user, role: 'SUPER_ADMIN' })).toBe(true);
    expect(scope.isGlobal(user)).toBe(false);
  });

  it('sella el dueño con el `sub` del token, nunca con datos del body', () => {
    const { scope } = scopeWith();

    expect(scope.ownership(user)).toEqual({ ownerId: 'u-1', businessId: 'biz-1' });
    // Sin businessId en el token, queda null (no se inventa).
    expect(scope.ownership({ sub: 'u-2' })).toEqual({ ownerId: 'u-2', businessId: null });
  });

  it('assertProfile consulta con el filtro de alcance y devuelve 404 si no lo alcanza', async () => {
    const notFound = scopeWith(vi.fn().mockResolvedValue(null));
    await expect(notFound.scope.assertProfile(user, 'p-ajeno')).rejects.toThrow(NotFoundException);

    expect(notFound.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p-ajeno', OR: [{ ownerId: 'u-1' }, { ownerId: null }] },
      }),
    );

    const found = scopeWith(vi.fn().mockResolvedValue({ id: 'p-1' }));
    await expect(found.scope.assertProfile(user, 'p-1')).resolves.toBeUndefined();
  });

  it('devuelve 404 (no 403): no le confirma a un usuario que el id de otro existe', async () => {
    const notFound = scopeWith(vi.fn().mockResolvedValue(null));

    await expect(notFound.scope.assertProfile(user, 'p-de-otro')).rejects.toThrow(
      /no existe/,
    );
  });
});
