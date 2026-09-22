import { z } from 'zod';
import { FormatKeySchema, PlatformKeySchema } from '../platforms/platforms.schema';
import { FORMAT_KEYS, PLATFORM_KEYS, formatsFor, platform } from '../platforms/platforms.catalog';

/**
 * Prompt y contrato de generación de ideas.
 *
 * Se le pasan SOLO las señales relevantes (ya filtradas y puntuadas) y el catálogo
 * de formatos válidos por red: así el modelo no inventa un "Reel de LinkedIn" ni
 * ideas sin sustento. Cada idea queda atada a los ids de las señales que la
 * sostienen (`IdeaSignal`), que es lo que la vuelve defendible.
 */

export const IdeaSchema = z.object({
  title: z.string().min(5).max(200),
  hook: z.string().min(5).max(400),
  angle: z.string().min(10).max(1200),
  /** Por qué AHORA: ligado a las señales, no una opinión. */
  whyNow: z.string().min(5).max(600),
  platform: PlatformKeySchema,
  format: FormatKeySchema,
  hashtags: z.array(z.string().max(60)).max(15).default([]),
  /** Pistas de horario en texto (la UI las muestra; no se inventan fechas). */
  bestTimes: z
    .array(z.object({ day: z.string().max(60), hour: z.string().max(60), reason: z.string().max(200) }))
    .max(3)
    .default([]),
  /** Ids de las señales que la sustentan (los que le dimos). */
  signalIds: z.array(z.string().min(1)).min(1).max(5),
});

export const IdeasResponseSchema = z.object({ ideas: z.array(IdeaSchema).max(20) });

export type IdeaFromLlm = z.infer<typeof IdeaSchema>;
export type IdeasResponse = z.infer<typeof IdeasResponseSchema>;

export const IDEAS_HINT = `{
  "ideas": [
    {
      "title": "título corto y concreto de la pieza",
      "hook": "la primera línea / los primeros 2 segundos",
      "angle": "el enfoque y de qué se trata, en 2 o 3 frases",
      "whyNow": "por qué conviene publicarlo ahora, atado a las señales",
      "platform": "INSTAGRAM | TIKTOK | YOUTUBE | LINKEDIN",
      "format": "formato válido de esa red",
      "hashtags": ["3 a 5, específicos"],
      "bestTimes": [{ "day": "martes", "hour": "19-21 h", "reason": "por qué" }],
      "signalIds": ["ids de las señales que la sostienen"]
    }
  ]
}`;

export interface IdeasPromptInput {
  profile: {
    name: string;
    niche: string[];
    audience: string | null;
    voice: string | null;
    language: string;
    platforms: string[];
    objectives: string[];
  };
  /** Cuántas ideas se le piden (freno de costo por perfil). */
  count: number;
  signals: Array<{
    id: string;
    title: string;
    summary: string | null;
    reasons: string[];
    score: number;
    platform: string | null;
    kind: string;
  }>;
}

export function buildIdeasSystemPrompt(): string {
  return [
    'Sos un coach de contenido para redes sociales. Tu trabajo es convertir tendencias reales en ideas publicables para un perfil concreto.',
    'Cada idea tiene que poder ejecutarse mañana: sin generalidades, sin "hablá de tu experiencia" como único ángulo.',
    'Apoyate en las señales que te doy y citá sus ids: una idea sin señal es una opinión.',
    'El formato tiene que existir en la red elegida (te paso la lista). En LinkedIn un "Reel" no existe: es un video o un documento.',
    'Escribí en el idioma del perfil y con su tono. No inventes datos, cifras ni casos que no estén en las señales.',
    'Devolvés menos ideas si las señales no dan para más: es mejor 2 buenas que 5 de relleno.',
  ].join('\n');
}

export function buildIdeasUserPrompt(input: IdeasPromptInput): string {
  const { profile, signals, count } = input;

  const catalog = profile.platforms.length
    ? profile.platforms
        .filter((key) => (PLATFORM_KEYS as readonly string[]).includes(key))
        .map((key) => `${platform(key as never).label}: formatos válidos → ${formatsFor(key as never).join(', ')} (por defecto ${platform(key as never).defaultFormats.join(', ')}). ${platform(key as never).bestTimesHint}`)
        .join('\n')
    : `Ninguna red cargada: usá solo ${PLATFORM_KEYS.join(', ')} y elegí el formato entre ${FORMAT_KEYS.join(', ')}.`;

  const list = signals
    .map(
      (signal) =>
        `- id=${signal.id} · ${signal.kind}${signal.platform ? ` en ${signal.platform}` : ''} · relevancia ${signal.score}\n` +
        `  ${signal.title}\n` +
        (signal.summary ? `  ${signal.summary.slice(0, 300)}\n` : '') +
        (signal.reasons.length ? `  por qué es relevante: ${signal.reasons.join('; ')}\n` : ''),
    )
    .join('\n');

  return [
    `Perfil: ${profile.name}`,
    `Nicho: ${profile.niche.length > 0 ? profile.niche.join(', ') : 'sin declarar'}`,
    `Audiencia: ${profile.audience ?? 'no declarada'}`,
    `Tono: ${profile.voice ?? 'no declarado'}`,
    `Idioma: ${profile.language}`,
    `Objetivos: ${profile.objectives.length > 0 ? profile.objectives.join('; ') : 'sin objetivos declarados'}`,
    '',
    'Formatos y horarios por red:',
    catalog,
    '',
    `Señales disponibles (${signals.length}):`,
    list,
    '',
    `Proponé hasta ${count} ideas, cada una sostenida por al menos una de esas señales (usá sus ids).`,
  ].join('\n');
}

/**
 * Sugerencia de hueco en el calendario: próximos días hábiles a las 10.
 *
 * Es una **sugerencia de orden**, no una regla del coach: el horario real lo
 * recomienda la IA en `bestTimes` (texto) y el usuario lo mueve en el calendario.
 * Se calcula acá para que las ideas no queden todas apiladas el mismo día.
 */
export function suggestSchedule(count: number, from: Date = new Date()): Date[] {
  const slots: Date[] = [];
  const cursor = new Date(from);

  while (slots.length < count) {
    cursor.setDate(cursor.getDate() + 1);
    const weekday = cursor.getDay();
    if (weekday === 0 || weekday === 6) continue; // fin de semana afuera
    const slot = new Date(cursor);
    slot.setHours(10, 0, 0, 0);
    slots.push(slot);
  }

  return slots;
}
