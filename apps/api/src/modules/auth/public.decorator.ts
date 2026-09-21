import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'social-harness:isPublic';

/**
 * Marca un endpoint como público (sin token).
 *
 * Se usa lo menos posible: solo `/health` (lo llama el healthcheck del
 * contenedor, que no tiene sesión). Todo lo demás exige el JWT de atiende.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
