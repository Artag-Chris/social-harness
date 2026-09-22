import { z } from 'zod';

/**
 * Reporte de rendimiento: qué funcionó, qué no y qué ajustar.
 *
 * La honestidad es parte del contrato: las métricas son **por cuenta y día**, no por
 * publicación, así que la atribución es gruesa. El prompt lo dice y el modelo tiene
 * que declararlo en vez de inventar una causa. El reporte que miente es peor que no
 * tener reporte.
 */

export const PerformanceReportSchema = z.object({
  summary: z.string().min(20).max(3000),
  whatWorked: z.array(z.string().min(5).max(400)).max(8).default([]),
  whatDidnt: z.array(z.string().min(5).max(400)).max(8).default([]),
  adjustments: z.array(z.string().min(5).max(400)).max(8).default([]),
});

export type PerformanceReportContent = z.infer<typeof PerformanceReportSchema>;

export const PERFORMANCE_HINT = `{
  "summary": "qué pasó en el período, con los números que te di",
  "whatWorked": ["lo que muestran los datos a favor"],
  "whatDidnt": ["lo que muestran los datos en contra"],
  "adjustments": ["qué cambiar en el próximo período"]
}`;

export interface PerformancePromptInput {
  profile: {
    name: string;
    niche: string[];
    audience: string | null;
    objectives: string[];
  };
  period: { from: string; to: string; days: number };
  /** Deltas por cuenta, ya calculados (el modelo no hace cuentas: las interpreta). */
  accounts: Array<{
    platform: string;
    handle: string;
    followers?: { from: number; to: number };
    reach?: number;
    impressions?: number;
    engagementRate?: number;
    likes?: number;
    comments?: number;
    shares?: number;
    saves?: number;
    daysMeasured: number;
  }>;
  published: Array<{ title: string; platform: string; format: string; publishedAt: string }>;
  topSignals: Array<{ title: string; score: number }>;
}

export function buildPerformanceSystemPrompt(): string {
  return [
    'Sos un analista de contenido. Te paso los números de un período y las publicaciones que salieron, y tenés que decir qué funcionó, qué no y qué ajustar.',
    'REGLA CRÍTICA: los datos son por CUENTA y por DÍA, no por publicación. No podés atribuir el resultado de una pieza concreta. Si los datos no alcanzan para concluir algo, escribilo así ("no alcanza para saber si fue X") en vez de inventar una causa.',
    'No inventes números que no estén en lo que te paso, ni compares contra períodos que no te di.',
    'Sobre `engagement`: es la tasa que reporta la plataforma (la arma quien exporta las métricas: puede ser interacciones sobre impresiones o sobre alcance) y acá viene **promediada** entre los días cargados. No la recalcules ni la corrijas: si te parece inconsistente con los conteos crudos, decí que hay que definir la fórmula, no la cambies por tu cuenta.',
    'Cada punto tiene que ser accionable y concreto: "publicá 3 veces por semana en lugar de 1" sirve; "mejorá el engagement" no.',
    'Escribí en español, sin adornos y sin felicitar al usuario.',
  ].join('\n');
}

export function buildPerformanceUserPrompt(input: PerformancePromptInput): string {
  const { profile, period, accounts, published, topSignals } = input;

  const accountLines = accounts
    .map((account) => {
      const parts: string[] = [`- ${account.platform} (${account.handle}) · ${account.daysMeasured} día(s) medidos`];
      if (account.followers) {
        const delta = account.followers.to - account.followers.from;
        parts.push(
          `  seguidores: ${account.followers.from} → ${account.followers.to} (${delta >= 0 ? '+' : ''}${delta})`,
        );
      }
      if (account.reach !== undefined) parts.push(`  alcance acumulado: ${account.reach}`);
      if (account.impressions !== undefined) parts.push(`  impresiones acumuladas: ${account.impressions}`);
      if (account.engagementRate !== undefined) parts.push(`  engagement promedio: ${account.engagementRate} %`);
      if (account.likes !== undefined) parts.push(`  likes: ${account.likes}`);
      if (account.comments !== undefined) parts.push(`  comentarios: ${account.comments}`);
      if (account.shares !== undefined) parts.push(`  compartidos: ${account.shares}`);
      if (account.saves !== undefined) parts.push(`  guardados: ${account.saves}`);
      return parts.join('\n');
    })
    .join('\n\n');

  const publishedLines = published.length
    ? published
        .map((item) => `- ${item.title} · ${item.platform}/${item.format} · publicado el ${item.publishedAt}`)
        .join('\n')
    : '(no se marcó ninguna publicación como publicada en el período)';

  const signalLines = topSignals.length
    ? topSignals.map((signal) => `- ${signal.title} (relevancia ${signal.score})`).join('\n')
    : '(sin señales destacadas)';

  return [
    `Perfil: ${profile.name}`,
    `Nicho: ${profile.niche.length > 0 ? profile.niche.join(', ') : 'sin declarar'}`,
    `Audiencia: ${profile.audience ?? 'no declarada'}`,
    `Objetivos: ${profile.objectives.length > 0 ? profile.objectives.join('; ') : 'sin objetivos declarados'}`,
    '',
    `Período: ${period.from} → ${period.to} (${period.days} días)`,
    '',
    'Números por cuenta:',
    accountLines.length > 0 ? accountLines : '(no hay métricas cargadas en el período)',
    '',
    'Se publicó:',
    publishedLines,
    '',
    'Lo que estaba sonando (contexto, no resultado):',
    signalLines,
    '',
    'Decime qué funcionó, qué no y qué ajustar en el próximo período.',
  ].join('\n');
}
