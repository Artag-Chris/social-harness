import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../config/env';
import { AuthGuard } from './auth.guard';
import type { AuthPayload } from './auth.types';

/**
 * El guard es lo que hace que una sola sesión (la de atiende) sirva para todo el
 * ecosistema. Se prueba la cadena completa: público, sin token, token roto, token
 * vencido, token válido.
 */
function contextFor(request: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function reflectorWith(isPublic: boolean): Reflector {
  return { getAllAndOverride: vi.fn().mockReturnValue(isPublic) } as unknown as Reflector;
}

describe('AuthGuard', () => {
  let jwt: JwtService;

  beforeEach(() => {
    jwt = new JwtService({ secret: env.JWT_SECRET });
  });

  it('deja pasar los endpoints marcados como públicos (el healthcheck no tiene sesión)', async () => {
    const guard = new AuthGuard(jwt, reflectorWith(true));
    const request: Record<string, unknown> = { headers: {} };

    expect(await guard.canActivate(contextFor(request))).toBe(true);
    expect(request.auth).toBeUndefined();
  });

  it('rechaza sin header de autorización', async () => {
    const guard = new AuthGuard(jwt, reflectorWith(false));

    await expect(guard.canActivate(contextFor({ headers: {} }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rechaza un esquema que no es Bearer', async () => {
    const guard = new AuthGuard(jwt, reflectorWith(false));
    const token = jwt.sign({ sub: 'u1' });

    await expect(
      guard.canActivate(contextFor({ headers: { authorization: `Basic ${token}` } })),
    ).rejects.toThrow(/Bearer/);
  });

  it('rechaza un token firmado con otro secreto (el caso del server mal configurado)', async () => {
    const guard = new AuthGuard(jwt, reflectorWith(false));
    const ajeno = new JwtService({ secret: 'otro-secreto' }).sign({ sub: 'u1' });

    await expect(
      guard.canActivate(contextFor({ headers: { authorization: `Bearer ${ajeno}` } })),
    ).rejects.toThrow(/inválida o expirada/);
  });

  it('rechaza un token vencido', async () => {
    const guard = new AuthGuard(jwt, reflectorWith(false));
    const vencido = new JwtService({ secret: env.JWT_SECRET }).sign({ sub: 'u1' }, { expiresIn: -10 });

    await expect(
      guard.canActivate(contextFor({ headers: { authorization: `Bearer ${vencido}` } })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rechaza un token sin `sub` (no serviría para sellar dueño)', async () => {
    const guard = new AuthGuard(jwt, reflectorWith(false));
    const sinSub = jwt.sign({ email: 'x@y.com' });

    await expect(
      guard.canActivate(contextFor({ headers: { authorization: `Bearer ${sinSub}` } })),
    ).rejects.toThrow(/`sub`/);
  });

  it('con un token válido deja pasar y expone el usuario en el request', async () => {
    const guard = new AuthGuard(jwt, reflectorWith(false));
    const request: { headers: Record<string, string>; auth?: AuthPayload } = {
      headers: { authorization: `Bearer ${jwt.sign({ sub: 'u-1', email: 'a@b.com', businessId: 'biz-1', role: 'ADMIN' })}` },
    };

    expect(await guard.canActivate(contextFor(request))).toBe(true);
    expect(request.auth).toEqual({
      sub: 'u-1',
      email: 'a@b.com',
      businessId: 'biz-1',
      role: 'ADMIN',
      iat: expect.any(Number),
    });
  });
});
