import { z } from 'zod';
import { format, formatLabel, platform } from '../platforms/platforms.catalog';

/**
 * Borrador de una pieza, generado **solo a demanda** (botón), nunca desde el pipeline
 * (ADR-001/003): el costo lo decide el humano y el texto es una propuesta, no algo
 * que se publique solo.
 *
 * El contrato separa caption y guion porque no son lo mismo: en un video el
 * entregable es el guion (el caption acompaña); en un post de texto, el caption ES la
 * pieza. La UI muestra los dos y el usuario decide qué usa.
 */

export const DraftContentSchema = z.object({
  caption: z.string().min(10).max(5000),
  script: z.string().max(9000).default(''),
  hookVariants: z.array(z.string().min(3).max(300)).max(5).default([]),
  cta: z.string().max(400).default(''),
  /** Notas de producción: qué grabar, qué mostrar, qué evitar. */
  notes: z.string().max(1500).default(''),
});

export type DraftContent = z.infer<typeof DraftContentSchema>;

export const DRAFT_HINT = `{
  "caption": "el texto que acompaña la publicación",
  "script": "el guion: qué se dice y qué se muestra, escena por escena (vacío si es una pieza de texto)",
  "hookVariants": ["2 o 3 arranques alternativos"],
  "cta": "la llamada a la acción",
  "notes": "notas de producción (qué grabar o mostrar, qué evitar)"
}`;

export interface DraftPromptInput {
  profile: {
    name: string;
    niche: string[];
    audience: string | null;
    voice: string | null;
    language: string;
  };
  idea: {
    title: string;
    hook: string;
    angle: string;
    whyNow: string;
    platform: string;
    format: string;
    hashtags: string[];
  };
  signals: Array<{ title: string; summary: string | null; url: string | null }>;
  /**
   * Segmentos de audiencia activos, en texto (`community.prompt.ts`): el mismo objeto que
   * usa el coach de comunidad es el que hace que el borrador hable como le habla a alguien.
   */
  audienceSegments: string[];
}

export function buildDraftSystemPrompt(): string {
  return [
    'Sos un redactor de contenido para redes sociales. Escribís una pieza para una red concreta, en el idioma y el tono del perfil.',
    'Escribís como escribe una persona: frases cortas, sin relleno, sin "en el mundo actual", sin listas de tres adjetivos, sin promesas vacías.',
    'PROHIBIDO inventar datos, cifras, casos, clientes o estudios que no estén en el material que te doy. Si falta un dato, se escribe sin ese dato.',
    'Si te paso segmentos de audiencia, escribí para UNO —el que le queda mejor a la idea— usando sus palabras y atendiendo su objeción. Un texto que le habla "a todos" se nota y no le sirve a nadie.',
    'Nada de marcar que lo escribió una IA, ni disclaimers, ni emojis decorativos.',
    'Devuelves SOLO lo que pide el contrato: el texto listo para pegar, no una explicación de lo que harías.',
  ].join('\n');
}

export function buildDraftUserPrompt(input: DraftPromptInput): string {
  const { profile, idea, signals, audienceSegments } = input;
  const platformDef = platform(idea.platform as never);
  const formatDef = format(idea.format as never);

  const material = signals
    .map(
      (signal, index) =>
        `${index + 1}. ${signal.title}${signal.url ? ` (${signal.url})` : ''}` +
        (signal.summary ? `\n   ${signal.summary.slice(0, 400)}` : ''),
    )
    .join('\n');

  return [
    `Perfil: ${profile.name}`,
    `Nicho: ${profile.niche.length > 0 ? profile.niche.join(', ') : 'sin declarar'}`,
    `Audiencia: ${profile.audience ?? 'no declarada'}`,
    `Tono: ${profile.voice ?? 'no declarado'}`,
    `Idioma: ${profile.language}`,
    '',
    'A quién le hablás (elegí UNO y escribí para esa persona):',
    audienceSegments.length > 0 ? audienceSegments.join('\n') : '(sin segmentos cargados todavía)',
    '',
    `Red: ${platformDef.label} · Formato: ${formatLabel(idea.format as never)}`,
    `Qué funciona en ${platformDef.label}: ${platformDef.contentHint}`,
    `Sobre el formato: ${formatDef.notes ?? 'sin notas'}`,
    `Hashtags: ${platformDef.hashtagsHint}`,
    `Mejores horarios: ${platformDef.bestTimesHint}`,
    '',
    'La idea a escribir:',
    `- Título: ${idea.title}`,
    `- Gancho: ${idea.hook}`,
    `- Enfoque: ${idea.angle}`,
    `- Por qué ahora: ${idea.whyNow}`,
    idea.hashtags.length > 0 ? `- Hashtags sugeridos: ${idea.hashtags.join(' ')}` : '',
    '',
    'Material real en el que te podés apoyar (no inventes nada fuera de esto):',
    material.length > 0 ? material : '(no hay material adicional: escribí sin datos concretos)',
    '',
    formatDef.isVideo
      ? 'Es una pieza de video: el guion es el entregable principal.'
      : 'Es una pieza de texto: el caption es el entregable principal (el guion puede quedar vacío).',
  ]
    .filter((line) => line !== '')
    .join('\n');
}
