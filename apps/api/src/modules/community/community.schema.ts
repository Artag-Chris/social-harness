import { z } from 'zod';
import { CommunityKindSchema, CommunityStatusSchema } from './community.catalog';

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

// ─────────────────────────────────────────────────────────────────────────────
// Comunidades
// ─────────────────────────────────────────────────────────────────────────────

const optionalText = z.string().trim().max(500).nullish();

export const TargetInputSchema = z.object({
  name: z.string().trim().min(3).max(160),
  kind: CommunityKindSchema,
  url: optionalText,
  size: z.string().trim().max(80).nullish(),
  activity: z.string().trim().max(80).nullish(),
  /** 0–100. Lo propone la IA y el humano lo puede corregir. */
  audienceFit: z.number().int().min(0).max(100).default(60),
  why: z.string().trim().min(10).max(600),
  segmentId: z.string().trim().max(40).nullish(),
  notes: z.string().trim().max(1000).nullish(),
});

export const TargetPatchSchema = z.object({
  name: z.string().trim().min(3).max(160).optional(),
  kind: CommunityKindSchema.optional(),
  url: optionalText,
  size: z.string().trim().max(80).nullish(),
  activity: z.string().trim().max(80).nullish(),
  audienceFit: z.number().int().min(0).max(100).optional(),
  why: z.string().trim().min(10).max(600).optional(),
  notes: z.string().trim().max(1000).nullish(),
  segmentId: z.string().trim().max(40).nullish(),
  status: CommunityStatusSchema.optional(),
  /** Marca (o desmarca) que el humano confirmó que existe y es el lugar correcto. */
  verified: z.boolean().optional(),
});

export const TargetListQuerySchema = z.object({
  status: CommunityStatusSchema.optional(),
});

/** Proponer para un segmento puntual (opcional): sin esto, propone para toda la audiencia. */
export const ProposeTargetsQuerySchema = z.object({
  segmentId: z.string().trim().max(40).optional(),
});

export type TargetInput = z.infer<typeof TargetInputSchema>;
export type TargetPatch = z.infer<typeof TargetPatchSchema>;
export type TargetListQuery = z.infer<typeof TargetListQuerySchema>;
export type ProposeTargetsQuery = z.infer<typeof ProposeTargetsQuerySchema>;
