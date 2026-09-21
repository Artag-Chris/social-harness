import { z } from 'zod';
import { SourceKind } from '@prisma/client';
import { features } from '../../config/features';

/**
 * Contratos de las fuentes de tendencia.
 *
 * Cada `kind` tiene sus propios `params`: por eso se valida con una unión
 * discriminada y no con un objeto genérico. Sumar un tipo de fuente es agregar
 * su variante acá (y su adaptador en `modules/connectors`, fase 2).
 */

const URL_MESSAGE = 'Falta esta URL (o no es una URL válida).';

const httpUrl = z
  .string({ required_error: URL_MESSAGE, invalid_type_error: URL_MESSAGE })
  .url({ message: URL_MESSAGE })
  .refine((value) => /^https?:\/\//i.test(value), {
    message: 'La URL debe ser http(s).',
  });

/** Política de cortesía y límites técnicos de una fuente. */
export const SourceLimitsSchema = z
  .object({
    maxPages: z.number().int().min(1).max(50),
    maxItems: z.number().int().min(1).max(500),
    delayMs: z.number().int().min(0).max(60_000),
    timeoutMs: z.number().int().min(1_000).max(120_000),
    respectRobots: z.boolean(),
    userAgent: z.string().max(300),
    headers: z.record(z.string().max(500)),
  })
  .partial();

/**
 * Texto obligatorio con un mensaje propio TAMBIÉN cuando la clave falta.
 * (`z.string().min(1, msg)` solo aplica si el valor es un string: para una clave
 * ausente Zod responde "Required" y el usuario no se entera de qué se trata.)
 */
const requiredText = (message: string) =>
  z.string({ required_error: message, invalid_type_error: message }).min(1, message);

/** Receta de selectores CSS (mismo contrato que el conector PUBLIC_WEB). */
export const RecipeSchema = z.object({
  selectors: z.object({
    item: requiredText('El selector del contenedor (`item`) es obligatorio.'),
    title: z.string().optional(),
    url: z.string().optional(),
    author: z.string().optional(),
    metrics: z.string().optional(),
    keywords: z.string().optional(),
    postedAt: z.string().optional(),
    description: z.string().optional(),
    nextPage: z.string().optional(),
  }),
  fetchDetail: z.boolean().optional(),
});

const paramsByKind = {
  RSS: z.object({
    feedUrl: httpUrl,
    maxItems: z.number().int().min(1).max(200).default(20),
  }),
  YOUTUBE_API: z.object({
    keywords: z.array(z.string().min(2).max(80)).min(1).max(10),
    region: z.string().length(2).default('CO'),
    maxItems: z.number().int().min(1).max(100).default(25),
  }),
  GOOGLE_TRENDS: z.object({
    keywords: z.array(z.string().min(2).max(80)).min(1).max(10),
    region: z.string().length(2).default('CO'),
  }),
  PUBLIC_WEB: z.object({
    listUrl: httpUrl,
    recipe: RecipeSchema,
  }),
  MANUAL: z.object({
    note: z.string().max(1000).optional(),
  }),
} satisfies Record<SourceKind, z.ZodTypeAny>;

/** Campos comunes a toda fuente, sin importar el tipo. */
const baseFields = {
  name: z.string().min(2).max(120),
  limits: SourceLimitsSchema.default({}),
  /** Cadencia por defecto; el perfil puede sobrescribirla al seleccionarla. */
  intervalHours: z.number().int().min(1).max(24 * 30).default(features.scheduler.sourceDefaultIntervalHours),
  enabled: z.boolean().default(true),
};

export const SourceKindSchema = z.nativeEnum(SourceKind);

export const SourceInputSchema = z.discriminatedUnion('kind', [
  z.object({ ...baseFields, kind: z.literal(SourceKind.RSS), params: paramsByKind.RSS }),
  z.object({ ...baseFields, kind: z.literal(SourceKind.YOUTUBE_API), params: paramsByKind.YOUTUBE_API }),
  z.object({ ...baseFields, kind: z.literal(SourceKind.GOOGLE_TRENDS), params: paramsByKind.GOOGLE_TRENDS }),
  z.object({ ...baseFields, kind: z.literal(SourceKind.PUBLIC_WEB), params: paramsByKind.PUBLIC_WEB }),
  z.object({ ...baseFields, kind: z.literal(SourceKind.MANUAL), params: paramsByKind.MANUAL }),
]);

/**
 * Edición: el `kind` NO se cambia (sería otra fuente distinta). Si vienen
 * `params`, se validan contra el tipo que la fuente ya tiene.
 */
export const SourceUpdateSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  limits: SourceLimitsSchema.optional(),
  intervalHours: z.number().int().min(1).max(24 * 30).optional(),
  enabled: z.boolean().optional(),
  params: z.unknown().optional(),
});

/** Verificar una fuente antes de guardarla: no crea nada. */
export const ProbeInputSchema = z.object({
  kind: SourceKindSchema,
  params: z.unknown(),
  limits: SourceLimitsSchema.optional(),
});

/**
 * Valida los `params` según el tipo. Se usa en el probe y en el PATCH, donde la
 * unión discriminada no puede aplicarse (no viene el `kind` en el body).
 */
export function parseParams(kind: SourceKind, params: unknown): unknown {
  return paramsByKind[kind].parse(params);
}

export type SourceInput = z.infer<typeof SourceInputSchema>;
export type SourceUpdateInput = z.infer<typeof SourceUpdateSchema>;
export type ProbeInput = z.infer<typeof ProbeInputSchema>;
export type SourceLimits = z.infer<typeof SourceLimitsSchema>;
export type ProbeItem = {
  title: string;
  url: string;
  author?: string | null;
  publishedAt?: string | null;
  summary?: string | null;
  metrics?: Record<string, number>;
};
