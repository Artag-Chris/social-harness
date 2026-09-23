import { z } from 'zod';

/**
 * Prompt y contrato de la propuesta de audiencia.
 *
 * La regla que gobierna este prompt es la misma que la del reporte: **no inventar**. Un
 * segmento con datos demográficos inventados ("mujeres de 25 a 34") es peor que un segmento
 * corto basado en lo que el perfil ya dijo: la audiencia se describe por lo que le pasa y
 * por dónde está, no por estadísticas que nadie cargó.
 */

export const AudienceSegmentsSchema = z.object({
  segments: z
    .array(
      z.object({
        name: z.string().min(3).max(120),
        description: z.string().min(20).max(600),
        pains: z.array(z.string().min(3).max(200)).max(6).default([]),
        desires: z.array(z.string().min(3).max(200)).max(6).default([]),
        objections: z.array(z.string().min(3).max(200)).max(6).default([]),
        /// Dónde está esa gente: es lo que después alimenta la búsqueda de comunidades.
        channels: z.array(z.string().min(3).max(120)).max(8).default([]),
        languageTips: z.string().max(400).default(''),
        /// En qué se basó: lo que vuelve la propuesta auditable.
        basedOn: z.array(z.string().min(3).max(200)).max(6).default([]),
      }),
    )
    .min(1)
    .max(5),
});

export type AudienceSegmentsContent = z.infer<typeof AudienceSegmentsSchema>;

export const SEGMENTS_HINT = `{
  "segments": [
    {
      "name": "nombre corto del segmento (a quién le hablás)",
      "description": "ese segmento en 2 o 3 frases",
      "pains": ["problemas concretos que tiene hoy"],
      "desires": ["qué quiere lograr"],
      "objections": ["por qué NO te seguiría o no te compraría"],
      "channels": ["dónde está esa gente: subreddit, grupo, hashtag, canal, newsletter"],
      "languageTips": "cómo le habla y qué jerga usa",
      "basedOn": ["de qué material salió (señal, idea publicada, objetivo)"]
    }
  ]
}`;

export interface SegmentsPromptInput {
  profile: {
    name: string;
    niche: string[];
    audience: string | null;
    voice: string | null;
    language: string;
    objectives: string[];
  };
  /** Señales que el análisis ya marcó como relevantes para este perfil. */
  signals: Array<{ title: string; score: number }>;
  /** Lo que ya publicó: el mejor indicio de con quién está conectando. */
  published: Array<{ title: string; platform: string }>;
  /** Segmentos que ya existen (para no repetir los que el usuario escribió). */
  existing: string[];
}

export function buildSegmentsSystemPrompt(): string {
  return [
    'Sos un estratega de audiencias. Te paso lo que sabe un perfil (nicho, a quién le habla, su tono) y material real (señales, publicaciones), y tenés que proponer 2 a 4 segmentos de audiencia accionables.',
    'REGLA CRÍTICA: no inventes datos que no estén en el material. Nada de edades, géneros, ingresos ni países si no te los dieron. Describí el segmento por lo que le pasa, lo que quiere y dónde está: si necesitás un dato que no tenés, no lo pongas.',
    'Cada segmento tiene que ser DISTINTO en lo que implica hacer: si dos segmentos se responden con el mismo contenido, es uno solo.',
    'Las objeciones son la parte más útil: por qué esa persona no te seguiría todavía. Escribilas aunque incomoden.',
    'En `channels` poné lugares concretos y verificables (un subreddit, un tipo de grupo, un hashtag), no "las redes sociales".',
    'En `basedOn` decí de qué material salió cada segmento: es lo que permite auditar la propuesta.',
    'Prohibido el tono de agencia: nada de "audiencia aspiracional premium". Español de LatAm, directo.',
  ].join('\n');
}

export function buildSegmentsUserPrompt(input: SegmentsPromptInput): string {
  const { profile, signals, published, existing } = input;

  const signalLines = signals.length
    ? signals.map((signal) => `- ${signal.title} (relevancia ${signal.score})`).join('\n')
    : '(sin señales analizadas todavía)';

  const publishedLines = published.length
    ? published.map((idea) => `- ${idea.title} · ${idea.platform}`).join('\n')
    : '(todavía no marcó publicaciones)';

  return [
    `Perfil: ${profile.name}`,
    `Nicho: ${profile.niche.length > 0 ? profile.niche.join(', ') : 'sin declarar'}`,
    `Audiencia (texto libre del perfil): ${profile.audience ?? 'no declarada'}`,
    `Tono: ${profile.voice ?? 'no declarado'}`,
    `Idioma: ${profile.language}`,
    `Objetivos: ${profile.objectives.length > 0 ? profile.objectives.join('; ') : 'sin objetivos declarados'}`,
    '',
    existing.length > 0 ? `Segmentos que YA existen (no los repitas, y si uno está mal, corregilo con otro nombre): ${existing.join(' | ')}` : '',
    '',
    'Lo que está sonando en su nicho:',
    signalLines,
    '',
    'Lo que ya publicó:',
    publishedLines,
    '',
    'Proponé 2 a 4 segmentos. Para cada uno: qué le duele, qué quiere, por qué no te seguiría, dónde está y de qué te basaste.',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/**
 * Los segmentos en texto para los otros prompts (ideas, borradores, reporte).
 *
 * Es la razón de existir del modelo: el mismo objeto que produce el coach de comunidad es el
 * que hace que una idea deje de hablarle "a la audiencia" en general.
 */
export function formatSegmentsForPrompt(
  segments: Array<{
    name: string;
    description: string;
    pains: string[];
    desires: string[];
    objections: string[];
    languageTips: string | null;
  }>,
): string[] {
  return segments.map((segment) => {
    const lines = [`- ${segment.name}: ${segment.description}`];
    if (segment.pains.length > 0) lines.push(`  le duele: ${segment.pains.join('; ')}`);
    if (segment.desires.length > 0) lines.push(`  quiere: ${segment.desires.join('; ')}`);
    if (segment.objections.length > 0) lines.push(`  no te sigue porque: ${segment.objections.join('; ')}`);
    if (segment.languageTips) lines.push(`  cómo le habla: ${segment.languageTips}`);
    return lines.join('\n');
  });
}
