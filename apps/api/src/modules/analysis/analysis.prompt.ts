import { z } from 'zod';
import { platformLabel } from '../platforms/platforms.catalog';

/**
 * Prompt y contrato del análisis de relevancia.
 *
 * Una sola llamada por perfil y por ciclo con TODAS las señales del lote (ADR-001):
 * el gasto crece con los perfiles, no con la cantidad de señales.
 *
 * El contrato es un array con el `signalId` de cada juicio: así el resultado se
 * cruza por id y una respuesta incompleta no rompe nada (las que falten se quedan
 * con el score determinístico del prefilter).
 */

export const AnalysisResponseSchema = z.object({
  results: z
    .array(
      z.object({
        signalId: z.string().min(1),
        score: z.number().min(0).max(100),
        reasons: z.array(z.string().min(3).max(200)).max(5).default([]),
      }),
    )
    .max(200),
});

export type AnalysisResponse = z.infer<typeof AnalysisResponseSchema>;

export const ANALYSIS_HINT = `{
  "results": [
    { "signalId": "el id que te di", "score": 0-100, "reasons": ["por qué", "otra razón"] }
  ]
}`;

export interface AnalysisPromptInput {
  profile: {
    name: string;
    niche: string[];
    audience: string | null;
    voice: string | null;
    platforms: string[];
    objectives: string[];
  };
  signals: Array<{
    id: string;
    kind: string;
    platform: string | null;
    title: string;
    summary: string | null;
    keywords: string[];
    ageDays: number;
    engagement: number;
  }>;
}

export function buildAnalysisSystemPrompt(): string {
  return [
    'Sos un analista de contenido para redes sociales. Tu trabajo es juzgar si una señal (una tendencia, una noticia, un video o un post) le sirve a un perfil para crecer.',
    'Puntuás cada señal de 0 a 100 pensando en si le da una idea accionable a ESE perfil, no en si el tema es interesante en general.',
    'Un 80+ es "esto hay que publicarlo ya". Un 40 es "relacionado pero flojo". Un 10 es "no tiene nada que ver".',
    'Sé exigente con el ruido: si el tema no toca el nicho declarado, el puntaje es bajo aunque la señal sea viral.',
    'Devolvés SIEMPRE un score por CADA id que te dieron, y como máximo 3 razones cortas por señal (en español, concretas, sin adjetivos vacíos).',
  ].join('\n');
}

export function buildAnalysisUserPrompt(input: AnalysisPromptInput): string {
  const { profile, signals } = input;

  const objectives =
    profile.objectives.length > 0 ? profile.objectives.join('; ') : 'sin objetivos declarados';
  const platforms =
    profile.platforms.length > 0
      ? profile.platforms.map((key) => platformLabel(key)).join(', ')
      : 'sin cuentas cargadas';

  const list = signals
    .map(
      (signal, index) =>
        `${index + 1}. id=${signal.id}\n` +
        `   tipo: ${signal.kind}${signal.platform ? ` · red: ${signal.platform}` : ''}\n` +
        `   título: ${signal.title}\n` +
        (signal.summary ? `   resumen: ${truncate(signal.summary, 400)}\n` : '') +
        (signal.keywords.length > 0 ? `   temas: ${signal.keywords.join(', ')}\n` : '') +
        `   antigüedad: ${Math.round(signal.ageDays)} día(s) · alcance: ${signal.engagement}`,
    )
    .join('\n\n');

  return [
    `Perfil: ${profile.name}`,
    `Nicho: ${profile.niche.length > 0 ? profile.niche.join(', ') : 'sin nicho declarado'}`,
    `Audiencia: ${profile.audience ?? 'no declarada'}`,
    `Tono: ${profile.voice ?? 'no declarado'}`,
    `Redes donde publica: ${platforms}`,
    `Objetivos: ${objectives}`,
    '',
    `Señales a evaluar (${signals.length}):`,
    '',
    list,
    '',
    'Puntuá CADA señal de 0 a 100 según lo útil que sea para este perfil.',
  ].join('\n');
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}
