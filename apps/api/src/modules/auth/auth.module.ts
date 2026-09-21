import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { env } from '../../config/env';
import { AccessScope } from './access-scope.service';
import { AuthGuard } from './auth.guard';

/**
 * Módulo de auth.
 *
 * - Registra `AuthGuard` como guard GLOBAL (`APP_GUARD`): un endpoint nuevo nace
 *   protegido; para abrirlo hay que decirlo explícitamente con `@Public()`.
 * - Configura `JwtModule` con el `JWT_SECRET` compartido con atiende. Si en el
 *   server ese secreto no coincide, el guard devuelve 401 y la pestaña lo avisa.
 * - Expone `AccessScope`, que es lo que usan los servicios para filtrar por dueño.
 */
@Global()
@Module({
  imports: [
    JwtModule.register({
      secret: env.JWT_SECRET,
      // `jsonwebtoken` acepta "1d"/"12h" en runtime, pero sus tipos piden
      // `number | StringValue`: por eso el cast (el valor lo valida Zod y tiene
      // formato de duración).
      signOptions: { expiresIn: env.JWT_EXPIRES_IN as unknown as number },
    }),
  ],
  providers: [AuthGuard, AccessScope, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AccessScope, JwtModule],
})
export class AuthModule {}
