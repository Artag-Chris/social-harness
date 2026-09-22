import { normalize } from '../../common/dup-key';

/**
 * Prefilter determinístico: ordena y recorta ANTES de gastar IA.
 *
 * Para qué existe (control de costo, ADR-001): si cada señal nueva fuera a la IA,
 * el gasto crecería con la cantidad de señales. Acá se puntúa gratis y solo las
 * mejores entran al lote que se le manda al modelo.
 *
 * Y hay un segundo uso: **este score es el respaldo**. Si no hay proveedor de IA (o
 * devuelve algo inválido), el score determinístico es el que queda — así el pipeline
 * funciona sin llaves en vez de quedarse sin relevancia.
 *
 * El puntaje es explicable a propósito: cada componente suma y deja su razón, que es
 * lo que la UI muestra ("toca tu nicho", "1.2M de vistas").
 */

export interface ProfileForScoring {
  niche: string[];
  /** Redes donde el perfil tiene cuenta. */
  platforms: string[];
}

export interface SignalForScoring {
  title: string;
  summary: string | null;
  keywords: string[];
  platform: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  metrics: Record<string, unknown>;
}

export interface Relevance {
  score: number;
  reasons: string[];
}

/** Pesos: suman 100. */
const NICHE_FIRST = 30;
const NICHE_EXTRA = 15;
const NICHE_CAP = 45;
const RECENCY_2D = 25;
const RECENCY_WEEK = 18;
const RECENCY_MONTH = 8;
const ENGAGEMENT_HIGH = 20;
const ENGAGEMENT_MID = 12;
const ENGAGEMENT_LOW = 5;
const PLATFORM_MATCH = 10;

export function scoreSignal(
  profile: ProfileForScoring,
  signal: SignalForScoring,
  now: Date = new Date(),
): Relevance {
  const reasons: string[] = [];
  let score = 0;

  // 1) Nicho: lo que más pesa. Se busca cada tema del perfil en el texto de la
  // señal (título, resumen, keywords y palabras clave de la URL no: sería ruido).
  const haystack = normalize([signal.title, signal.summary ?? '', signal.keywords.join(' ')].join(' '));
  const matched = profile.niche
    .map((term) => ({ term, normalized: normalize(term) }))
    .filter(({ normalized }) => normalized.length >= 3 && haystack.includes(normalized));

  if (matched.length > 0) {
    const points = Math.min(NICHE_CAP, NICHE_FIRST + NICHE_EXTRA * (matched.length - 1));
    score += points;
    reasons.push(`Toca tu nicho: ${matched.slice(0, 3).map((m) => m.term).join(', ')}`);
  }

  // 2) Frescura: una tendencia de hace un mes no sirve para decidir hoy.
  const date = signal.publishedAt ?? signal.createdAt;
  const ageDays = Math.max(0, (now.getTime() - date.getTime()) / 86_400_000);
  if (ageDays <= 2) {
    score += RECENCY_2D;
    reasons.push('Muy reciente (menos de 2 días)');
  } else if (ageDays <= 7) {
    score += RECENCY_WEEK;
    reasons.push('De esta semana');
  } else if (ageDays <= 30) {
    score += RECENCY_MONTH;
    reasons.push('Del último mes');
  }

  // 3) Tracción: lo que más se vio/interactuó suele ser lo que está funcionando.
  const engagement = topMetric(signal.metrics);
  if (engagement >= 100_000) {
    score += ENGAGEMENT_HIGH;
    reasons.push(`${formatCompact(engagement)} de alcance`);
  } else if (engagement >= 10_000) {
    score += ENGAGEMENT_MID;
    reasons.push(`${formatCompact(engagement)} de alcance`);
  } else if (engagement >= 1_000) {
    score += ENGAGEMENT_LOW;
    reasons.push(`${formatCompact(engagement)} de alcance`);
  }

  // 4) Red donde el perfil ya publica: la idea se puede ejecutar.
  if (signal.platform && profile.platforms.includes(signal.platform)) {
    score += PLATFORM_MATCH;
    reasons.push(`Tenés cuenta en ${signal.platform}`);
  }

  return { score: Math.min(100, Math.round(score)), reasons };
}

export interface PrefilteredSignal<T> {
  signal: T;
  relevance: Relevance;
}

/** Ordena por puntaje y recorta al lote que se le va a mandar a la IA. */
export function prefilter<T extends SignalForScoring>(
  profile: ProfileForScoring,
  signals: T[],
  limit: number,
  now: Date = new Date(),
): Array<PrefilteredSignal<T>> {
  return signals
    .map((signal) => ({ signal, relevance: scoreSignal(profile, signal, now) }))
    .sort((a, b) => b.relevance.score - a.relevance.score)
    .slice(0, limit);
}

/**
 * Métrica más alta que trajo la fuente. Es defensivo a propósito: `metrics` es JSON
 * libre (cada fuente trae lo que puede), así que no se asume ninguna clave.
 */
export function topMetric(metrics: Record<string, unknown>): number {
  const values = Object.values(metrics).filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  );
  return values.length > 0 ? Math.max(...values) : 0;
}

function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`;
  if (value >= 1_000) return `${Math.round(value / 100) / 10}K`;
  return String(value);
}
