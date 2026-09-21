import { z } from 'zod';
import { SignalKind } from '@prisma/client';
import { PlatformKeySchema } from '../platforms/platforms.schema';

/**
 * Contrato de salida de TODOS los conectores.
 *
 * Por qué un contrato único: el pipeline (ingestión, dedup, análisis, ideas) no
 * sabe ni le importa de dónde vino la señal — YouTube, un RSS o algo pegado a
 * mano entran exactamente por acá. Sumar una fuente nueva no toca el pipeline.
 *
 * Se valida con Zod en la frontera porque un conector habla con terceros: un
 * item raro no debe tumbar la corrida completa (se descarta y se avisa).
 */
export const SignalDraftSchema = z.object({
  /** Qué es: tendencia, video, post, noticia o inspiración pegada a mano. */
  kind: z.nativeEnum(SignalKind),
  /**
   * URL de la señal. El dedup se calcula sobre su versión canónica.
   * Se restringe a http(s) a propósito: `z.string().url()` acepta también
   * `file:`, `ftp:` o `javascript:`, y el pipeline va a hacer fetch de esto.
   */
  url: z
    .string()
    .url()
    .refine((value) => /^https?:\/\//i.test(value), {
      message: 'Solo se permiten URLs http(s) en las señales.',
    }),
  title: z.string().min(1),
  author: z.string().nullish(),
  /**
   * Red de la que viene la señal. Se valida contra el catálogo de redes
   * (`modules/platforms`), no contra un enum de la base: sumar una red no debe
   * obligar a una migración.
   */
  platform: PlatformKeySchema.nullish(),
  publishedAt: z.coerce.date().nullish(),
  region: z.string().nullish(),
  keywords: z.array(z.string()).default([]),
  /** Métricas que trajo la fuente: { views, likes, comments, shares, score }. */
  metrics: z.record(z.number()).default({}),
  /**
   * Texto corto (descripción/resumen) para el embedding, el prefilter y el
   * prompt de análisis. Sin esto, la señal es solo un título.
   */
  summary: z.string().nullish(),
  /** Item crudo: permite reprocesar sin volver a pedirle nada al tercero. */
  raw: z.record(z.unknown()).default({}),
});

export type SignalDraft = z.infer<typeof SignalDraftSchema>;

export const ConnectorResultSchema = z.object({
  items: z.array(SignalDraftSchema),
  /**
   * Avisos NO fatales: "sin YOUTUBE_API_KEY", "la página está detrás de un
   * challenge", "el feed no traía items". Se muestran en la UI y en la corrida;
   * no convierten la corrida en fallo.
   */
  warnings: z.array(z.string()).default([]),
});

export type ConnectorResult = z.infer<typeof ConnectorResultSchema>;
