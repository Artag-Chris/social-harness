import type { ObjectiveMetric } from '@prisma/client';

/**
 * Crecimiento y gap de objetivos: la pregunta "¿voy a llegar?".
 *
 * Por qué existe: el reporte de rendimiento interpreta números, pero no contesta la
 * pregunta que el usuario realmente tiene. Eso es **aritmética, no interpretación**, así
 * que se calcula acá —funciones puras, sin IA y sin base de datos— y tanto el prompt del
 * reporte como el endpoint `/growth` reciben el resultado ya resuelto. Un modelo haciendo
 * cuentas es una fuente de errores difíciles de detectar.
 *
 * Regla de honestidad: cuando no hay mediciones suficientes para estimar un ritmo, se dice
 * (`NO_PACE`) en vez de inventar una proyección. Un "vas a llegar" falso es peor que un
 * "todavía no se puede saber".
 */

const DAY_MS = 86_400_000;

export interface GrowthSnapshot {
  socialAccountId: string;
  capturedAt: Date;
  followers?: number | null;
  reach?: number | null;
  impressions?: number | null;
  engagementRate?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  saves?: number | null;
}

export interface GrowthAccount {
  id: string;
  platform: string;
  handle: string;
}

export interface GrowthObjective {
  metric: ObjectiveMetric;
  targetValue: number;
  currentValue: number | null;
  dueDate: Date | null;
}

export interface AccountGrowth {
  platform: string;
  handle: string;
  /** `from → to` y el ritmo semanal observado en la ventana medida. */
  followers?: { from: number; to: number; delta: number; perWeek: number };
  reach?: number;
  impressions?: number;
  engagementRate?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  /** Días CON medición (el snapshot es por cuenta y día). */
  daysMeasured: number;
  /** Ventana real entre la primera y la última medición, en días (mínimo 1). */
  windowDays: number;
}

/**
 * Veredicto de un objetivo. `NO_PACE` y `NO_CURRENT` existen para no mentir: son los
 * casos donde los datos no alcanzan.
 */
export type ObjectiveVerdict = 'ACHIEVED' | 'ON_TRACK' | 'BEHIND' | 'NO_PACE' | 'NO_CURRENT';

/** Unidad del objetivo, para que quien lo muestre no tenga que adivinarla. */
export type ObjectiveUnit = 'COUNT' | 'PERCENT' | 'PER_WEEK';

export interface ObjectiveGap {
  metric: ObjectiveMetric;
  unit: ObjectiveUnit;
  target: number;
  /** Valor de hoy: el manual (`Objective.currentValue`) manda; si no, se deriva. */
  current: number | null;
  /** Cuánto falta para el objetivo (null si ya está cumplido o si no hay dato). */
  remaining: number | null;
  daysLeft: number | null;
  /** Lo que hace falta por semana para llegar a tiempo. */
  neededPerWeek: number | null;
  /** Lo que se viene sumando por semana (`null` = no hay ritmo medible todavía). */
  currentPerWeek: number | null;
  /** A dónde llegás si seguís al ritmo actual, al vencer el plazo. */
  projected: number | null;
  verdict: ObjectiveVerdict;
}

export interface Growth {
  windowDays: number;
  accounts: AccountGrowth[];
  objectives: ObjectiveGap[];
  measured: { accounts: number; snapshots: number };
}

/**
 * Valores que solo conoce quien llama (p. ej. POSTS_PER_WEEK sale de las ideas publicadas,
 * no de las métricas). Se inyectan para que este módulo siga siendo puro.
 */
export type MeasuredByCode = Partial<Record<ObjectiveMetric, number>>;

export interface BuildGrowthInput {
  accounts: GrowthAccount[];
  objectives: GrowthObjective[];
  snapshots: GrowthSnapshot[];
  /** Para el cálculo de "días que faltan". Inyectable para poder testearlo. */
  now?: Date;
  measuredByCode?: MeasuredByCode;
}

export function buildGrowth(input: BuildGrowthInput): Growth {
  const now = input.now ?? new Date();
  const accounts = buildAccountGrowth(input.accounts, input.snapshots);

  const windowDays =
    input.snapshots.length > 0 ? windowDaysOf(input.snapshots) : 0;

  return {
    windowDays,
    accounts,
    objectives: buildObjectiveGaps({
      objectives: input.objectives,
      accounts: input.accounts,
      growth: accounts,
      snapshots: input.snapshots,
      now,
      ...(input.measuredByCode ? { measuredByCode: input.measuredByCode } : {}),
    }),
    measured: { accounts: accounts.length, snapshots: input.snapshots.length },
  };
}

/** Los números por cuenta, con el ritmo semanal de seguidores. */
export function buildAccountGrowth(
  accounts: GrowthAccount[],
  snapshots: GrowthSnapshot[],
): AccountGrowth[] {
  const byAccount = groupByAccount(snapshots);
  const growth: AccountGrowth[] = [];

  for (const account of accounts) {
    const list = (byAccount.get(account.id) ?? []).slice().sort(byCapturedAt);
    const first = list[0];
    const last = list[list.length - 1];
    if (!first || !last) continue;

    const days = windowDaysOf(list);

    growth.push({
      platform: account.platform,
      handle: account.handle,
      ...(first.followers !== null &&
      first.followers !== undefined &&
      last.followers !== null &&
      last.followers !== undefined
        ? {
            followers: {
              from: first.followers,
              to: last.followers,
              delta: last.followers - first.followers,
              perWeek: round(((last.followers - first.followers) / days) * 7, 1),
            },
          }
        : {}),
      ...optional('reach', sum(list, 'reach')),
      ...optional('impressions', sum(list, 'impressions')),
      ...optional('engagementRate', average(list, 'engagementRate')),
      ...optional('likes', sum(list, 'likes')),
      ...optional('comments', sum(list, 'comments')),
      ...optional('shares', sum(list, 'shares')),
      ...optional('saves', sum(list, 'saves')),
      daysMeasured: list.length,
      windowDays: days,
    });
  }

  return growth;
}

interface BuildObjectiveGapsInput {
  objectives: GrowthObjective[];
  accounts: GrowthAccount[];
  growth: AccountGrowth[];
  snapshots: GrowthSnapshot[];
  now: Date;
  measuredByCode?: MeasuredByCode;
}

export function buildObjectiveGaps(input: BuildObjectiveGapsInput): ObjectiveGap[] {
  return input.objectives.map((objective) => {
    const unit = unitOf(objective.metric);
    const derived = deriveCurrent(objective.metric, input);
    // El valor manual manda: si el usuario lo cargó, es la verdad (puede incluir cosas
    // que las métricas no ven, p. ej. leads de un formulario).
    const current = objective.currentValue ?? derived ?? null;

    const remaining = current === null ? null : round(objective.targetValue - current, 2);
    const daysLeft = objective.dueDate
      ? Math.ceil((objective.dueDate.getTime() - input.now.getTime()) / DAY_MS)
      : null;

    const neededPerWeek =
      remaining === null || daysLeft === null || daysLeft <= 0
        ? remaining !== null && remaining <= 0
          ? 0
          : null
        : round((remaining / daysLeft) * 7, 2);

    const currentPerWeek = paceOf(objective.metric, input);
    const weeksLeft = daysLeft !== null && daysLeft > 0 ? daysLeft / 7 : null;

    /**
     * Proyección al vencer el plazo.
     *
     * Ojo con las TASAS (`POSTS_PER_WEEK`): publicar 1,5 por semana no se "acumula" hasta
     * 11 en un mes — se mantiene. Proyectar una tasa como si fuera un stock da un
     * veredicto falso ("vas a llegar" publicando 1,5 de 3), y de los errores que se
     * propagan al usuario sin que nadie los note.
     */
    const projected =
      current === null || weeksLeft === null || currentPerWeek === null
        ? null
        : unit === 'PER_WEEK'
          ? round(current, 2)
          : round(current + currentPerWeek * weeksLeft, 2);

    return {
      metric: objective.metric,
      unit,
      target: objective.targetValue,
      current,
      remaining: remaining !== null && remaining <= 0 ? 0 : remaining,
      daysLeft,
      neededPerWeek,
      currentPerWeek,
      projected,
      verdict: verdictOf({
        current,
        remaining,
        projected,
        neededPerWeek,
        currentPerWeek,
        target: objective.targetValue,
      }),
    };
  });
}

/**
 * Qué valor mostrar para cada objetivo.
 *
 * FOLLOWERS/REACH/ENGAGEMENT_RATE se derivan de las métricas; LEADS no se puede derivar
 * (necesita el sistema del usuario) y POSTS_PER_WEEK sale de las publicaciones marcadas,
 * que las conoce quien llama.
 */
function deriveCurrent(metric: ObjectiveMetric, input: BuildObjectiveGapsInput): number | undefined {
  const fromCode = input.measuredByCode?.[metric];
  if (fromCode !== undefined) return fromCode;

  const byAccount = groupByAccount(input.snapshots);

  switch (metric) {
    case 'FOLLOWERS':
      return latestPerAccount(input.accounts, byAccount, 'followers', sumOf);
    case 'ENGAGEMENT_RATE':
      return latestPerAccount(input.accounts, byAccount, 'engagementRate', averageOf);
    case 'REACH':
      return sum(input.snapshots, 'reach');
    default:
      return undefined;
  }
}

/** El ritmo semanal por métrica, o `null` si los datos no alcanzan para estimarlo. */
function paceOf(metric: ObjectiveMetric, input: BuildObjectiveGapsInput): number | null {
  const fromCode = input.measuredByCode?.[metric];
  // POSTS_PER_WEEK **es** un ritmo semanal: si el llamador lo midió (ideas publicadas por
  // semana), ese valor ya es el ritmo.
  if (metric === 'POSTS_PER_WEEK') return fromCode === undefined ? null : round(fromCode, 2);

  const days = input.growth[0]?.windowDays ?? 0;

  switch (metric) {
    case 'FOLLOWERS': {
      // Solo las cuentas con DOS o más mediciones tienen ritmo: un delta sobre un único
      // día es ruido, no tendencia (y extrapolarlo a la semana sería inventar).
      const paced = input.growth.filter(
        (account) => account.daysMeasured >= 2 && account.followers !== undefined,
      );
      if (paced.length === 0) return null;
      return round(paced.reduce((total, account) => total + (account.followers?.perWeek ?? 0), 0), 1);
    }
    case 'REACH': {
      if (days <= 0) return null;
      const total = sum(input.snapshots, 'reach');
      return total === undefined ? null : round((total / days) * 7, 1);
    }
    case 'ENGAGEMENT_RATE': {
      const changes = input.accounts
        .map((account) => rateChange(account.id, input.snapshots))
        .filter((value): value is number => value !== null);
      if (changes.length === 0) return null;
      return round(changes.reduce((total, value) => total + value, 0) / changes.length, 2);
    }
    default:
      return null;
  }
}

function verdictOf(input: {
  current: number | null;
  remaining: number | null;
  projected: number | null;
  neededPerWeek: number | null;
  currentPerWeek: number | null;
  target: number;
}): ObjectiveVerdict {
  if (input.current === null) return 'NO_CURRENT';
  if (input.remaining !== null && input.remaining <= 0) return 'ACHIEVED';
  // Sin plazo no se puede estar "atrasado": hay distancia, pero no una fecha que perder.
  if (input.neededPerWeek === null) return 'NO_PACE';
  // Sin ritmo medible tampoco: decir "no llegás" sería adivinar.
  if (input.currentPerWeek === null || input.projected === null) return 'NO_PACE';
  return input.projected >= input.target ? 'ON_TRACK' : 'BEHIND';
}

export function unitOf(metric: ObjectiveMetric): ObjectiveUnit {
  if (metric === 'ENGAGEMENT_RATE') return 'PERCENT';
  if (metric === 'POSTS_PER_WEEK') return 'PER_WEEK';
  return 'COUNT';
}

/**
 * Las líneas que reciben los prompts (y que la plantilla sin IA reusa tal cual).
 *
 * Van calculadas a propósito: el modelo tiene que INTERPRETAR esto, no rehacerlo.
 */
export function formatGrowthForPrompt(growth: Growth): string[] {
  const lines: string[] = [];

  if (growth.accounts.length === 0) {
    lines.push('(no hay métricas cargadas, así que no hay crecimiento que calcular)');
  } else {
    for (const account of growth.accounts) {
      const parts: string[] = [`- ${account.platform} (${account.handle}) · ${account.daysMeasured} día(s)`];
      if (account.followers) {
        parts.push(
          `  seguidores: ${account.followers.from} → ${account.followers.to} (${signed(account.followers.delta)} en la ventana ≈ ${signed(account.followers.perWeek)}/semana)`,
        );
      }
      if (account.engagementRate !== undefined) {
        parts.push(`  engagement promedio: ${account.engagementRate} %`);
      }
      if (account.reach !== undefined) parts.push(`  alcance acumulado: ${account.reach}`);
      lines.push(parts.join('\n'));
    }
  }

  for (const objective of growth.objectives) {
    lines.push(`- ${lineOf(objective)}`);
  }

  return lines;
}

/** Una línea por objetivo, con el veredicto en palabras. */
export function lineOf(objective: ObjectiveGap): string {
  const unit = unitLabel(objective.unit);
  const target = `${objective.target}${unit}`;

  if (objective.current === null) {
    return `${objective.metric}: objetivo ${target} · sin datos para saber dónde estás (cargá el valor a mano o las métricas)`;
  }

  // En las tasas, "hoy" es la ÚLTIMA medición —no el promedio del período— y se dice, para
  // que el modelo no lo lea como un número contradictorio con el promedio de la cuenta.
  const currentLabel = objective.unit === 'PERCENT' ? `${objective.current}${unit} (última medición)` : `${objective.current}${unit}`;
  const head = `${objective.metric}: objetivo ${target} · hoy ${currentLabel}`;

  if (objective.remaining === 0 || objective.remaining === null) {
    return `${head} → cumplido`;
  }

  const missing = `faltan ${objective.remaining}${unit}`;
  const deadline = objective.daysLeft !== null ? ` en ${objective.daysLeft} día(s)` : '';
  const needed =
    objective.neededPerWeek !== null ? ` → hace falta +${objective.neededPerWeek}${unit}/semana` : '';
  const pace =
    objective.currentPerWeek !== null
      ? ` · ritmo actual ${signed(objective.currentPerWeek)}${unit}/semana`
      : ' · sin ritmo medible (hacen falta al menos dos días de medición)';

  const verdict =
    objective.verdict === 'ACHIEVED'
      ? ' → llegaste'
      : objective.verdict === 'ON_TRACK'
        ? ` → a este ritmo LLEGÁS${objective.projected !== null ? ` (${objective.projected}${unit} al vencer)` : ''}`
        : objective.verdict === 'BEHIND'
          ? ` → a este ritmo NO llegás${objective.projected !== null ? ` (${objective.projected}${unit} al vencer)` : ''}`
          : objective.daysLeft === null
            ? ' → sin plazo definido'
            : ' → no alcanza para saber si llegás';

  return `${head} · ${missing}${deadline}${needed}${pace}${verdict}`;
}

/** Texto corto para el reporte de plantilla (sin IA). */
export function formatGrowthForTemplate(growth: Growth): string[] {
  return growth.objectives
    .filter((objective) => objective.verdict === 'BEHIND')
    .map(
      (objective) =>
        `${objective.metric}: vas ${objective.remaining}${unitLabel(objective.unit)} abajo del objetivo y a este ritmo no llegás (hace falta +${objective.neededPerWeek}${unitLabel(objective.unit)}/semana).`,
    );
}

// ── helpers ──────────────────────────────────────────────────────────────────

function groupByAccount(snapshots: GrowthSnapshot[]): Map<string, GrowthSnapshot[]> {
  const grouped = new Map<string, GrowthSnapshot[]>();
  for (const snapshot of snapshots) {
    const list = grouped.get(snapshot.socialAccountId) ?? [];
    list.push(snapshot);
    grouped.set(snapshot.socialAccountId, list);
  }
  return grouped;
}

function byCapturedAt(a: GrowthSnapshot, b: GrowthSnapshot): number {
  return a.capturedAt.getTime() - b.capturedAt.getTime();
}

function windowDaysOf(list: GrowthSnapshot[]): number {
  const sorted = list.slice().sort(byCapturedAt);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return 0;
  return Math.max(1, Math.round((last.capturedAt.getTime() - first.capturedAt.getTime()) / DAY_MS));
}

/** Suma o promedio del ÚLTIMO valor de cada cuenta (el estado de hoy, no el acumulado). */
function latestPerAccount(
  accounts: GrowthAccount[],
  byAccount: Map<string, GrowthSnapshot[]>,
  field: 'followers' | 'engagementRate',
  combine: (values: number[]) => number | undefined,
): number | undefined {
  const values: number[] = [];

  for (const account of accounts) {
    const list = (byAccount.get(account.id) ?? []).slice().sort(byCapturedAt);
    for (let index = list.length - 1; index >= 0; index -= 1) {
      const value = list[index]?.[field];
      if (typeof value === 'number' && Number.isFinite(value)) {
        values.push(value);
        break;
      }
    }
  }

  return combine(values);
}

/** Cambio del engagement (en puntos) por semana, entre la primera y la última medición. */
function rateChange(accountId: string, snapshots: GrowthSnapshot[]): number | null {
  const list = snapshots
    .filter((snapshot) => snapshot.socialAccountId === accountId)
    .slice()
    .sort(byCapturedAt);
  const withRate = list.filter(
    (snapshot) => typeof snapshot.engagementRate === 'number' && Number.isFinite(snapshot.engagementRate),
  );
  const first = withRate[0];
  const last = withRate[withRate.length - 1];
  if (!first || !last || first === last) return null;

  const days = Math.max(
    1,
    Math.round((last.capturedAt.getTime() - first.capturedAt.getTime()) / DAY_MS),
  );
  const change = (last.engagementRate as number) - (first.engagementRate as number);
  return round((change / days) * 7, 2);
}

function sumOf(values: number[]): number | undefined {
  return values.length === 0 ? undefined : round(values.reduce((total, value) => total + value, 0), 2);
}

function averageOf(values: number[]): number | undefined {
  return values.length === 0 ? undefined : round(values.reduce((total, value) => total + value, 0) / values.length, 2);
}

function numbers(rows: GrowthSnapshot[], field: keyof GrowthSnapshot): number[] {
  return rows
    .map((row) => row[field])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
}

function sum(rows: GrowthSnapshot[], field: keyof GrowthSnapshot): number | undefined {
  return sumOf(numbers(rows, field));
}

function average(rows: GrowthSnapshot[], field: keyof GrowthSnapshot): number | undefined {
  return averageOf(numbers(rows, field));
}

function optional<K extends string>(key: K, value: number | undefined): Record<K, number> | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, number>);
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function signed(value: number): string {
  return `${value >= 0 ? '+' : ''}${value}`;
}

function unitLabel(unit: ObjectiveUnit): string {
  if (unit === 'PERCENT') return ' %';
  return '';
}
