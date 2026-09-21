import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { summarizeZodIssues } from './zod-issues';

/**
 * Validación de entrada con Zod.
 *
 * Por qué Zod y no `class-validator`: TODO el proyecto valida con Zod (la
 * configuración del boot, el contrato de los conectores, el catálogo de redes).
 * Meter una segunda librería de validación solo para los DTOs obligaría a
 * escribir cada contrato dos veces y a mantener dos estilos de error.
 *
 * Se usa como `@Body(new ZodValidationPipe(Schema))` y devuelve el dato ya
 * tipado: el servicio no vuelve a chequear nada.
 *
 * Nota: Zod descarta las claves desconocidas de un objeto (equivalente al
 * `whitelist: true` global), así que un campo de más no se cuela al servicio.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: z.ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);

    if (result.success) return result.data;

    throw new BadRequestException({
      message: 'Datos inválidos',
      // Campo por campo: el dashboard muestra esto tal cual, así que un error
      // tiene que decir QUÉ campo y POR QUÉ, no un dump del schema.
      issues: summarizeZodIssues(result.error),
    });
  }
}
