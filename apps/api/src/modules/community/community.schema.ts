import { z } from 'zod';

/**
 * Contratos de entrada del coach de comunidad.
 *
 * Mismo criterio que el resto del harness: se valida en la frontera con Zod y los límites
 * son reales (una lista de 200 dolores no es una lista, es un volcado).
 */

const text = z.string().trim().min(3).max(200);
const textList = z.array(text).max(8).default([]);

export const SegmentInputSchema = z.object({
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().min(10).max(600),
  pains: textList,
  desires: textList,
  objections: textList,
  /// Dónde está esa gente: es lo que después guía la búsqueda de comunidades.
  channels: textList,
  languageTips: z.string().trim().max(400).nullish(),
});

export const SegmentPatchSchema = SegmentInputSchema.partial().extend({
  /// Archivar es la forma de sacar un segmento del prompt sin perderlo.
  archived: z.boolean().optional(),
});

export const SegmentListQuerySchema = z.object({
  /**
   * Los archivados no entran al prompt, así que por defecto no se listan.
   *
   * Se declara como enum de strings y **sin `transform`** a propósito: el
   * `ZodValidationPipe` exige que el tipo de entrada y el de salida coincidan, y un
   * `transform` (o `z.coerce.boolean()`, que además convertiría "false" en `true`) rompe
   * ese contrato. La interpretación va en el servicio.
   */
  includeArchived: z.enum(['true', 'false']).optional(),
});

export type SegmentInput = z.infer<typeof SegmentInputSchema>;
export type SegmentPatch = z.infer<typeof SegmentPatchSchema>;
export type SegmentListQuery = z.infer<typeof SegmentListQuerySchema>;
