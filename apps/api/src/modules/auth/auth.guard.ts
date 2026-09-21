import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';
import type { AuthPayload, RequestWithAuth } from './auth.types';

/**
 * Guard global: exige el JWT de atiende en todos los endpoints salvo los
 * marcados con `@Public()`.
 *
 * Por qué el JWT de atiende y no uno propio: una sola sesión en todo el
 * ecosistema. El dashboard ya guarda ese token (`localStorage["atiende_auth"]`) y
 * lo manda como Bearer; el harness lo valida con el MISMO `JWT_SECRET` que
 * atiende tiene en el server. Si los secretos no coinciden, el guard responde
 * 401 y la pestaña lo dice — no hay segundo login ni sesión paralela.
 *
 * Solo VERIFICA (no emite): el único que firma es atiende. (El script
 * `dev-token` firma uno de prueba con el mismo secreto, para curl y Swagger.)
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithAuth & { headers: Record<string, unknown> }>();
    const token = extractBearerToken(request.headers.authorization);

    if (!token) {
      throw new UnauthorizedException(
        'Falta el token. Mandá `Authorization: Bearer <token>` (el harness reutiliza la sesión de atiende).',
      );
    }

    let payload: AuthPayload;
    try {
      payload = await this.jwt.verifyAsync<AuthPayload>(token);
    } catch {
      throw new UnauthorizedException(
        'Sesión inválida o expirada. Volvé a entrar por el dashboard de atiende.',
      );
    }

    if (typeof payload?.sub !== 'string' || payload.sub.length === 0) {
      // Un token sin `sub` no sirve para nada acá: es el dueño de todo.
      throw new UnauthorizedException('El token no trae el usuario (`sub`).');
    }

    request.auth = payload;
    return true;
  }
}

function extractBearerToken(header: unknown): string | null {
  if (typeof header !== 'string') return null;
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value) return null;
  return value.trim();
}
