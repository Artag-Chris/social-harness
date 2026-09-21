import { z } from 'zod';
import { FORMAT_KEYS, PLATFORM_KEYS, formatsFor, formatBelongsToPlatform } from './platforms.catalog';

/**
 * Validación derivada del catálogo.
 *
 * Esto es lo que reemplaza al enum de Postgres: la base guarda texto y la
 * integridad se exige acá, en la frontera. Agregar o quitar una red NO requiere
 * migración, solo tocar `platforms.catalog.ts`.
 */

export const PlatformKeySchema = z.enum(PLATFORM_KEYS);
export const FormatKeySchema = z.enum(FORMAT_KEYS);

/**
 * Par red + formato, validando que ese formato EXISTA en esa red.
 * El enum de la base no podía expresar esta relación (un `POLL` en Instagram
 * pasaba el tipo sin chistar).
 */
export const PlatformFormatSchema = z
  .object({ platform: PlatformKeySchema, format: FormatKeySchema })
  .superRefine((value, ctx) => {
    if (!formatBelongsToPlatform(value.platform, value.format)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['format'],
        message: `El formato "${value.format}" no existe en ${value.platform}. Válidos: ${formatsFor(value.platform).join(', ')}.`,
      });
    }
  });

export type PlatformFormat = z.infer<typeof PlatformFormatSchema>;
