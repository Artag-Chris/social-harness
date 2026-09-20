/**
 * Precedencia de cadencia de una fuente, en UN solo lugar.
 *
 * Hay tres niveles que pueden definir cada cuánto se recolecta y es fácil que
 * cada servicio invente su propio orden. La regla es, de más específico a más
 * general:
 *
 *   1. `ProfileSource.intervalHours`  → la cadencia que este perfil le puso a ESTA fuente
 *   2. `Profile.scheduleHours`        → la cadencia del perfil
 *   3. `Source.intervalHours`         → la cadencia de la fuente
 *   4. el fallback configurado         → `SOURCE_DEFAULT_INTERVAL_HOURS`
 *
 * Es una función pura a propósito: la usan el dispatcher y la UI, y se prueba
 * sin base de datos.
 */

export const DEFAULT_INTERVAL_HOURS = 24;

export interface IntervalInputs {
  /** Cadencia de la selección perfil ↔ fuente. */
  selectionHours?: number | null;
  /** Cadencia del perfil. */
  profileHours?: number | null;
  /** Cadencia de la fuente. */
  sourceHours?: number | null;
}

/** Una hora de cadencia es válida si es un entero positivo y finito. */
function isValidHours(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

export function resolveIntervalHours(
  inputs: IntervalInputs,
  fallbackHours: number = DEFAULT_INTERVAL_HOURS,
): number {
  const candidates = [inputs.selectionHours, inputs.profileHours, inputs.sourceHours];
  const winner = candidates.find(isValidHours);

  if (winner !== undefined) return winner;
  return isValidHours(fallbackHours) ? fallbackHours : DEFAULT_INTERVAL_HOURS;
}
