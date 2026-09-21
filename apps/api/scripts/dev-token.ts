/**
 * Firma un token de prueba con el MISMO `JWT_SECRET` del harness.
 *
 * Para qué: probar la API con curl o desde Swagger sin abrir el dashboard. En el
 * uso normal NO hace falta: el dashboard manda el token real de atiende y el
 * harness lo valida.
 *
 * ⚠️ Ojo con el dueño: cada perfil creado queda a nombre del `sub` del token. Si
 * firmás uno con el `sub` por defecto (`dev-user`), esos perfiles **no aparecen**
 * en la pestaña del dashboard (que usa tu `sub` real). Para verlos ahí, pasá tu
 * `sub` de atiende:
 *
 *   cd apps/api && npm run dev-token -- --sub=<tu-uuid-de-atiende>
 *
 * Y si querés el `sub` real, tomalo del token que ya tenés en el navegador
 * (`localStorage.atiende_auth.accessToken`) o de la tabla de usuarios de atiende.
 */
import 'dotenv/config';
import { JwtService } from '@nestjs/jwt';
import { env } from '../src/config/env';

interface Args {
  sub: string;
  email: string;
  businessId: string | null;
  role: string;
  expiresIn: string;
}

function parseArgs(argv: string[]): Args {
  const read = (name: string): string | undefined => {
    const withEquals = argv.find((arg) => arg.startsWith(`--${name}=`));
    if (withEquals) return withEquals.slice(name.length + 3);
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  return {
    sub: read('sub') ?? 'dev-user',
    email: read('email') ?? 'dev@socialharness.local',
    businessId: read('business-id') ?? null,
    role: read('role') ?? 'ADMIN',
    expiresIn: read('expires-in') ?? '7d',
  };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const jwt = new JwtService({
    secret: env.JWT_SECRET,
    // Mismo caso que en `auth.module`: el valor es una duración ("1d") y los
    // tipos de jsonwebtoken piden `number | StringValue`.
    signOptions: { expiresIn: args.expiresIn as unknown as number },
  });

  const token = jwt.sign({
    sub: args.sub,
    email: args.email,
    ...(args.businessId ? { businessId: args.businessId } : {}),
    role: args.role,
  });

  process.stdout.write(`sub=${args.sub}  (los perfiles que crees con este token quedan a su nombre)\n\n${token}\n`);
}

void main();
