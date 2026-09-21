import { z } from 'zod';
import { ObjectiveMetric, ObjectiveStatus } from '@prisma/client';
import { PlatformKeySchema } from '../platforms/platforms.schema';

/**
 * Contratos de entrada del módulo de perfiles.
 *
 * Se validan en el borde (`ZodValidationPipe`) y el servicio recibe datos ya
 * tipados: nada de `any` ni de chequeos repetidos adentro.
 */

/** Horas de cadencia: 1 h a 30 días. La UI ofrece valores gruesos, la API acepta cualquiera. */
const scheduleHours = z.number().int().min(1).max(24 * 30);

export const CreateProfileSchema = z.object({
  name: z.string().min(2).max(120),
  /** Temas del nicho: es el filtro más importante del análisis de relevancia. */
  niche: z.array(z.string().min(2).max(60)).max(20).default([]),
  audience: z.string().max(400).nullish(),
  voice: z.string().max(800).nullish(),
  language: z.string().min(2).max(10).default('es'),
  scheduleHours: scheduleHours.nullish(),
  ideasPerWeek: z.number().int().min(1).max(50).default(3),
  autoIdeasEnabled: z.boolean().default(true),
});

export const UpdateProfileSchema = CreateProfileSchema.partial();

export const ScheduleSchema = z.object({
  /** null = sin cadencia (no se recolecta solo; se puede pedir a mano). */
  scheduleHours: scheduleHours.nullable(),
});

export const AccountInputSchema = z.object({
  /** Clave del catálogo de redes (`GET /platforms`). */
  platform: PlatformKeySchema,
  handle: z.string().min(1).max(120),
  url: z
    .string()
    .url()
    .refine((value) => /^https?:\/\//i.test(value), { message: 'La URL debe ser http(s).' })
    .nullish(),
  /** Punto de partida para medir crecimiento relativo. */
  followersBaseline: z.number().int().min(0).nullish(),
  notes: z.string().max(500).nullish(),
});

export const UpdateAccountSchema = AccountInputSchema.partial();

export const ObjectiveInputSchema = z.object({
  metric: z.nativeEnum(ObjectiveMetric),
  targetValue: z.number().positive(),
  currentValue: z.number().min(0).nullish(),
  dueDate: z.coerce.date().nullish(),
  status: z.nativeEnum(ObjectiveStatus).optional(),
  notes: z.string().max(500).nullish(),
});

export const UpdateObjectiveSchema = ObjectiveInputSchema.partial();

/** Selección de fuentes de un perfil: reemplaza la lista completa. */
export const ProfileSourcesSchema = z.object({
  sourceIds: z.array(z.string().min(1)).max(200),
});

export const SourceSelectionSchema = z.object({
  enabled: z.boolean().optional(),
  /** null = hereda la cadencia del perfil (y si no, la de la fuente). */
  intervalHours: scheduleHours.nullish(),
});

export type CreateProfileInput = z.infer<typeof CreateProfileSchema>;
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;
export type AccountInput = z.infer<typeof AccountInputSchema>;
export type UpdateAccountInput = z.infer<typeof UpdateAccountSchema>;
export type ObjectiveInput = z.infer<typeof ObjectiveInputSchema>;
export type UpdateObjectiveInput = z.infer<typeof UpdateObjectiveSchema>;
export type SourceSelectionInput = z.infer<typeof SourceSelectionSchema>;
