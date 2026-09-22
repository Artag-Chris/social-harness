import { z } from 'zod';
import { IdeaStatus } from '@prisma/client';
import { FormatKeySchema, PlatformKeySchema } from '../platforms/platforms.schema';

/** Filtros del calendario/listado de ideas. */
export const IdeaListQuerySchema = z.object({
  profileId: z.string().min(1).optional(),
  status: z.nativeEnum(IdeaStatus).optional(),
  platform: PlatformKeySchema.optional(),
  /** Rango del calendario. */
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

/** Idea cargada a mano (el humano también propone, no solo la IA). */
export const IdeaInputSchema = z.object({
  profileId: z.string().min(1),
  platform: PlatformKeySchema,
  format: FormatKeySchema,
  title: z.string().min(3).max(200),
  hook: z.string().min(3).max(400),
  angle: z.string().min(3).max(1200),
  whyNow: z.string().min(3).max(600).default('La cargaste a mano.'),
  hashtags: z.array(z.string().max(60)).max(15).default([]),
  scheduledFor: z.coerce.date().nullish(),
});

export const IdeaUpdateSchema = z.object({
  status: z.nativeEnum(IdeaStatus).optional(),
  scheduledFor: z.coerce.date().nullish(),
  title: z.string().min(3).max(200).optional(),
  hook: z.string().min(3).max(400).optional(),
  angle: z.string().min(3).max(1200).optional(),
  hashtags: z.array(z.string().max(60)).max(15).optional(),
});

export type IdeaListQuery = z.infer<typeof IdeaListQuerySchema>;
export type IdeaInput = z.infer<typeof IdeaInputSchema>;
export type IdeaUpdateInput = z.infer<typeof IdeaUpdateSchema>;
