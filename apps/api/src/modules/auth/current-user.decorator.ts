import {
  UnauthorizedException,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import type { AuthPayload, RequestWithAuth } from './auth.types';

/**
 * Inyecta el usuario del token en el handler.
 *
 * Es lo que hace posible el aislamiento: los servicios reciben el `sub` y sellan
 * o filtran con él, en vez de leer un id que venga en el body (que el cliente
 * podría inventar).
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthPayload => {
    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    if (!request.auth) {
      // Solo puede pasar si un endpoint se marcó @Public y igual pide el usuario.
      throw new UnauthorizedException('No hay usuario en el contexto de la petición.');
    }
    return request.auth;
  },
);
