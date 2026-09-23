import { z } from 'zod';

/**
 * Métricas de una cuenta: un snapshot suelto o un CSV pegado.
 *
 * Deliberadamente **manual** en v1 (ADR-002): el trámite de apps y tokens de Meta/TikTok no debe
 * bloquear el MVP. El contrato ya está listo para que un conector oficial escriba los mismos campos
 * (`source: 'API'`).
 */

const metric = z.coerce.number().nonnegative().nullish();

export const MetricSnapshotInputSchema = z
  .object({
    /** Día del snapshot. Si no viene, es hoy. */
    capturedAt: z.coerce.date().nullish(),
    followers: metric,
    reach: metric,
    impressions: metric,
    /** En porcentaje (4 = 4 %). */
    engagementRate: metric,
    likes: metric,
    comments: metric,
    shares: metric,
    saves: metric,
    /**
     * CSV pegado tal cual (una fila por día). Alternativa a los campos sueltos:
     * sirve para cargar un mes de una vez.
     */
    csv: z.string().max(200_000).nullish(),
  })
  .refine(
    (value) =>
      Boolean(value.csv?.trim()) ||
      [
        value.followers,
        value.reach,
        value.impressions,
        value.engagementRate,
        value.likes,
        value.comments,
        value.shares,
        value.saves,
      ].some((field) => field !== null && field !== undefined),
    { message: 'Mandá al menos una métrica o un CSV con datos.' },
  );

export const MetricListQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(90),
});

/**
 * Ventana del cálculo de crecimiento. El mínimo es 7 días porque el ritmo se expresa por
 * semana: con menos, la extrapolación sería ruido con formato de dato.
 */
export const GrowthQuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(365).default(30),
});

export type MetricSnapshotInput = z.infer<typeof MetricSnapshotInputSchema>;
export type MetricListQuery = z.infer<typeof MetricListQuerySchema>;
export type GrowthQuery = z.infer<typeof GrowthQuerySchema>;

/** Un snapshot ya normalizado (fecha al día, números limpios). */
export interface MetricRow {
  capturedAt: Date;
  followers?: number;
  reach?: number;
  impressions?: number;
  engagementRate?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
}
