import type { MetricRow } from './metrics.schema';

/**
 * Parser del CSV que pega el usuario.
 *
 * Por qué existe: cargar un mes de métricas a mano, día por día, no lo hace nadie.
 * El usuario exporta (o arma) una tabla y la pega entera.
 *
 * Es tolerante a propósito —separador `,` o `;`, encabezados en español o inglés,
 * miles con punto o coma, `%` en el engagement, fechas en varios formatos— porque el
 * objetivo es que sirva el archivo que ya tiene, no pedirle un formato nuevo. Lo que
 * NO puede pasar es que invente datos: una fila sin fecha se descarta y se avisa.
 */

/** Encabezados aceptados por campo (normalizados: sin acentos, minúsculas). */
const HEADER_ALIASES: Record<keyof Omit<MetricRow, 'capturedAt'>, string[]> = {
  followers: ['followers', 'seguidores'],
  reach: ['reach', 'alcance', 'cuentas alcanzadas'],
  impressions: ['impressions', 'impresiones', 'vistas'],
  engagementRate: ['engagement', 'engagementrate', 'tasa', 'tasa de interaccion', 'interaccion'],
  likes: ['likes', 'me gusta', 'megusta', 'reacciones'],
  comments: ['comments', 'comentarios'],
  shares: ['shares', 'compartidos', 'compartidas'],
  saves: ['saves', 'guardados', 'guardadas'],
};

const DATE_ALIASES = ['fecha', 'date', 'dia', 'day'];

export interface ParsedMetricsCsv {
  rows: MetricRow[];
  warnings: string[];
}

export function parseMetricsCsv(csv: string): ParsedMetricsCsv {
  const warnings: string[] = [];
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) return { rows: [], warnings: ['El CSV está vacío.'] };

  const separator = detectSeparator(lines[0] ?? '');
  const header = splitLine(lines[0] ?? '', separator).map(normalizeHeader);

  const dateIndex = header.findIndex((column) => DATE_ALIASES.includes(column));
  if (dateIndex < 0) {
    return {
      rows: [],
      warnings: [
        'El CSV necesita una columna de fecha (por ejemplo `fecha` o `date`): sin fecha no se puede saber a qué día corresponden los números.',
      ],
    };
  }

  const fieldIndexes = new Map<keyof Omit<MetricRow, 'capturedAt'>, number>();
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as Array<
    [keyof Omit<MetricRow, 'capturedAt'>, string[]]
  >) {
    const index = header.findIndex((column) => aliases.includes(column));
    if (index >= 0) fieldIndexes.set(field, index);
  }

  if (fieldIndexes.size === 0) {
    warnings.push(
      'No reconocí ninguna columna de métricas (seguidores, alcance, impresiones, engagement, likes, comentarios, compartidos, guardados).',
    );
  }

  const rows: MetricRow[] = [];
  let skipped = 0;

  for (const line of lines.slice(1)) {
    const cells = splitLine(line, separator);
    const capturedAt = parseDate(cells[dateIndex] ?? '');
    if (!capturedAt) {
      skipped += 1;
      continue;
    }

    const row: MetricRow = { capturedAt };
    for (const [field, index] of fieldIndexes) {
      const value = parseNumber(cells[index] ?? '');
      if (value !== undefined) row[field] = value;
    }
    rows.push(row);
  }

  if (skipped > 0) {
    warnings.push(`${skipped} fila(s) sin fecha válida se descartaron (no se inventó el día).`);
  }
  if (rows.length === 0 && warnings.length === 0) {
    warnings.push('El CSV no tenía filas con datos.');
  }

  return { rows, warnings };
}

/** Cuenta comas y punto y comas fuera de comillas: gana el que más aparece. */
function detectSeparator(line: string): string {
  const commas = (line.match(/,/g) ?? []).length;
  const semicolons = (line.match(/;/g) ?? []).length;
  const tabs = (line.match(/\t/g) ?? []).length;
  if (tabs > commas && tabs > semicolons) return '\t';
  return semicolons > commas ? ';' : ',';
}

function splitLine(line: string, separator: string): string[] {
  // Soporta valores entrecomillados (`"1,200"`), que es lo que sale de Excel.
  const cells: string[] = [];
  let current = '';
  let quoted = false;

  for (const char of line) {
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === separator && !quoted) {
      cells.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current);

  return cells.map((cell) => cell.trim());
}

function normalizeHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Acepta ISO, `dd/mm/yyyy` y `yyyy-mm-dd` (los formatos que uno pega de una planilla). */
export function parseDate(value: string): Date | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  const dayFirst = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(trimmed);
  if (dayFirst) {
    const [, day, month, year] = dayFirst;
    return normalizeToDay(new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))));
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : normalizeToDay(parsed);
}

/** Números con miles (`1.200` / `1,200`), decimales y `%`. */
export function parseNumber(value: string): number | undefined {
  const trimmed = value.trim().replace('%', '').replace(/\s/g, '');
  if (trimmed.length === 0) return undefined;

  const digits = trimmed.replace(/[^\d.,-]/g, '');
  if (digits.length === 0) return undefined;

  let normalized = digits;
  if (/^\d{1,3}(\.\d{3})+$/.test(digits)) normalized = digits.replace(/\./g, '');
  else if (/^\d{1,3}(,\d{3})+$/.test(digits)) normalized = digits.replace(/,/g, '');
  else if (digits.includes(',') && !digits.includes('.')) normalized = digits.replace(',', '.');

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Normaliza al día (medianoche UTC): el snapshot es por DÍA, así que la hora no
 * importa y la clave única (cuenta + día) hace que reimportar actualice.
 */
export function normalizeToDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
