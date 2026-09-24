import { z } from 'zod';
import { CommunityKindSchema } from './community.catalog';

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

// ─────────────────────────────────────────────────────────────────────────────
// Comunidades: dónde participar
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Propuesta de comunidades.
 *
 * El riesgo acá es distinto al de la audiencia: un segmento mal descrito se corrige, pero una
 * comunidad **inventada** manda al usuario a buscar un subreddit que no existe. Por eso el
 * prompt es explícito en "si no estás seguro, no lo pongas", todo nace `PROPOSED`, y el
 * `url` y el `size` son opcionales (mejor vacío que falso).
 */
export const CommunityTargetsSchema = z.object({
  targets: z
    .array(
      z.object({
        name: z.string().min(3).max(160),
        kind: CommunityKindSchema,
        /// Vacío si el modelo no está seguro de la URL exacta.
        url: z.string().max(500).default(''),
        size: z.string().max(80).default(''),
        activity: z.string().max(80).default(''),
        audienceFit: z.number().int().min(0).max(100),
        why: z.string().min(20).max(600),
        /// El segmento al que apunta, por nombre (tiene que ser uno de los que le pasé).
        segmentName: z.string().max(120).default(''),
      }),
    )
    .min(1)
    .max(10),
});

export type CommunityTargetsContent = z.infer<typeof CommunityTargetsSchema>;

export const TARGETS_HINT = `{
  "targets": [
    {
      "name": "nombre del lugar (subreddit, grupo, canal, hashtag)",
      "kind": "REDDIT | FACEBOOK_GROUP | DISCORD | TELEGRAM | FORO | HASHTAG | CANAL | NEWSLETTER | OTRO",
      "url": "solo si estás seguro de la dirección; si no, dejalo vacío",
      "size": "tamaño si lo sabés (ej. '12k miembros'); si no, vacío",
      "activity": "alta | media | baja (si lo sabés)",
      "audienceFit": 0,
      "why": "por qué ESA gente está ahí y por qué te conviene entrar",
      "segmentName": "el nombre exacto del segmento al que le sirve"
    }
  ]
}`;

export interface TargetsPromptInput {
  profile: { name: string; niche: string[]; language: string };
  /** Segmentos activos: la propuesta sale de dónde está ESA gente. */
  segments: Array<{ name: string; description: string; channels: string[] }>;
  /** Comunidades que el perfil ya tiene (para no repetirlas). */
  existing: string[];
}

export function buildTargetsSystemPrompt(): string {
  return [
    'Sos un estratega de comunidad. Te paso un perfil con sus segmentos de audiencia y tenés que proponer dónde participar: subreddits, grupos, foros, canales, hashtags.',
    'REGLA CRÍTICA: proponé lugares que EXISTAN. Si no estás seguro de que un grupo o canal con ese nombre exacto exista, no lo propongas. Una lista corta y real vale más que una larga e inventada: el usuario va a perder tiempo buscando algo que no está.',
    'Si no estás seguro de la URL, dejalá vacía. Si no sabés el tamaño, dejalo vacío. Nada de números inventados.',
    'Cada propuesta tiene que decir por qué ESA gente está ahí: "es un grupo grande" no sirve; "ahí preguntan justo lo que vos resolvés" sí.',
    'Distingui el encaje: no todas pueden ser 90. Usá el rango completo y reservá los números altos para las mejores.',
    'En `segmentName` poné el nombre EXACTO de uno de los segmentos que te paso.',
    'Escribí en español de LatAm, sin tono de agencia.',
  ].join('\n');
}

export function buildTargetsUserPrompt(input: TargetsPromptInput): string {
  const { profile, segments, existing } = input;

  const segmentLines = segments
    .map((segment) => {
      const channels = segment.channels.length > 0 ? `\n  dónde está (ya declarado): ${segment.channels.join('; ')}` : '';
      return `- ${segment.name}: ${segment.description}${channels}`;
    })
    .join('\n');

  return [
    `Perfil: ${profile.name}`,
    `Nicho: ${profile.niche.length > 0 ? profile.niche.join(', ') : 'sin declarar'}`,
    `Idioma: ${profile.language}`,
    '',
    existing.length > 0 ? `Comunidades que YA tiene (no las repitas): ${existing.join(' | ')}` : '',
    '',
    'Sus segmentos de audiencia:',
    segmentLines,
    '',
    'Proponé de 3 a 6 lugares donde participar, priorizando los que ya aparecen en «dónde está» de cada segmento (si están ahí, están de verdad).',
  ]
    .filter((line) => line !== '')
    .join('\n');
}
