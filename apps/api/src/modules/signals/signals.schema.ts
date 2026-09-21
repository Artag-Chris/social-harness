import { z } from 'zod';
import { SignalKind } from '@prisma/client';
import { PlatformKeySchema } from '../platforms/platforms.schema';

/** Filtros del listado de señales (lo que la pestaña de Tendencias va a ofrecer). */
export const SignalListQuerySchema = z.object({
  /** Ver las señales que le tocaron a ESE perfil (con su relevancia). */
  profileId: z.string().min(1).optional(),
  platform: PlatformKeySchema.optional(),
  kind: z.nativeEnum(SignalKind).optional(),
  /** Relevancia mínima para el perfil (si se filtró por perfil). */
  minRelevance: z.coerce.number().min(0).max(100).optional(),
  /** Solo lo de los últimos N días. */
  days: z.coerce.number().int().min(1).max(365).optional(),
  q: z.string().min(2).max(120).optional(),
  /**
   * Duplicados: `hide` (por defecto) muestra solo lo original; `show` deja ver los
   * marcados; `all` trae todo junto.
   */
  duplicates: z.enum(['hide', 'show', 'all']).default('hide'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * Señal pegada a mano (inspiración o competencia).
 *
 * No lleva `url` obligatoria: muchas veces lo que se pega es el texto de un post
 * de LinkedIn, y ahí el dedup se hace por texto. `profileId` sí es obligatorio:
 * una inspiración se pega PARA un perfil, no al aire.
 */
export const ManualSignalSchema = z.object({
  profileId: z.string().min(1),
  text: z.string().min(20).max(20_000),
  url: z
    .string()
    .url()
    .refine((value) => /^https?:\/\//i.test(value), { message: 'La URL debe ser http(s).' })
    .nullish(),
  platform: PlatformKeySchema.nullish(),
  kind: z.nativeEnum(SignalKind).default(SignalKind.INSPIRATION),
  title: z.string().min(2).max(200).optional(),
  author: z.string().max(200).nullish(),
  /** Por qué te interesó: entra al prompt del análisis tal cual. */
  note: z.string().max(1000).nullish(),
});

export type SignalListQuery = z.infer<typeof SignalListQuerySchema>;
export type ManualSignalInput = z.infer<typeof ManualSignalSchema>;
