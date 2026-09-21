import * as cheerio from 'cheerio';
import type { ProbeItem } from '../sources.schema';

/**
 * Motor de recetas CSS: lee una página pública con los selectores que definió el
 * usuario y devuelve qué encontró.
 *
 * Es la misma semántica que va a usar el conector `PUBLIC_WEB` al recolectar
 * (fase 2), así que lo que se ve en la previsualización es lo que va a entrar.
 *
 * Además de los items devuelve **diagnóstico por selector**: cuántos items
 * matcheó cada uno. Sin eso, una receta que "no trae nada" es un misterio; con
 * eso, se ve de un vistazo qué selector está mal.
 */

export interface RecipeSelectors {
  item: string;
  title?: string;
  url?: string;
  author?: string;
  metrics?: string;
  keywords?: string;
  postedAt?: string;
  description?: string;
  nextPage?: string;
}

export interface RecipeDefinition {
  selectors: RecipeSelectors;
  fetchDetail?: boolean;
}

export interface SelectorDiagnostic {
  selector: string;
  field: string;
  matched: number;
}

export interface ParsedRecipe {
  items: ProbeItem[];
  diagnostics: SelectorDiagnostic[];
  warnings: string[];
}

/** Tope de items que se procesan en la verificación (no es una recolección). */
const MAX_ITEMS = 50;

export function parseRecipe(html: string, recipe: RecipeDefinition, baseUrl: string): ParsedRecipe {
  const $ = cheerio.load(html);
  const { selectors } = recipe;
  const warnings: string[] = [];

  const containers = $(selectors.item);
  const diagnostics = buildDiagnostics($, selectors, containers.length);

  if (containers.length === 0) {
    warnings.push(
      `El selector del contenedor ("${selectors.item}") no encontró nada en esta página. ` +
        'Puede que la página se arme con JavaScript o que el selector no corresponda.',
    );
  }

  const items: ProbeItem[] = [];
  const total = Math.min(containers.length, MAX_ITEMS);

  // Se itera con índice y `eq()` (en vez de `each`) para quedarse con el mismo
  // tipo de selección que el resto del archivo.
  for (let index = 0; index < total; index += 1) {
    const container = containers.eq(index);
    const title = selectors.title ? text(container.find(selectors.title).first().text()) : null;
    const href = selectors.url
      ? container.find(selectors.url).first().attr('href')
      : container.find('a').first().attr('href');
    const url = absolutize(href, baseUrl);

    // Un item sin título Y sin URL no se puede usar: no se puede deduplicar ni
    // analizar. Se saltea y se cuenta en los avisos.
    if (!url && !title) continue;

    const rawMetrics = selectors.metrics ? text(container.find(selectors.metrics).first().text()) : null;
    const metricsValue = rawMetrics ? parseMetricNumber(rawMetrics) : undefined;

    items.push({
      title: title ?? '(sin título)',
      url: url ?? '',
      author: pickText(container, selectors.author),
      publishedAt: selectors.postedAt
        ? toIsoDate(readDateLike(container, selectors.postedAt))
        : null,
      summary: pickText(container, selectors.description),
      metrics: metricsValue === undefined ? {} : { metric: metricsValue },
    });
  }

  const skipped = containers.length - items.length;
  if (skipped > 0 && containers.length > 0) {
    warnings.push(
      `${skipped} contenedor(es) no tenían título ni enlace y se descartaron: revisá los selectores ` +
        `de "${selectors.title ?? 'title'}" y "${selectors.url ?? 'url'}".`,
    );
  }
  if (containers.length > MAX_ITEMS) {
    warnings.push(`Se revisaron los primeros ${MAX_ITEMS} contenedores de ${containers.length}.`);
  }

  return { items, diagnostics, warnings };
}

function buildDiagnostics(
  $: cheerio.CheerioAPI,
  selectors: RecipeSelectors,
  containerCount: number,
): SelectorDiagnostic[] {
  const entries = Object.entries(selectors).filter(([field]) => field !== 'item') as Array<
    [string, string]
  >;

  const diagnostics: SelectorDiagnostic[] = [
    { field: 'item', selector: selectors.item, matched: containerCount },
  ];

  for (const [field, selector] of entries) {
    diagnostics.push({ field, selector, matched: $(selector).length });
  }

  return diagnostics;
}

/**
 * Convierte lo que muestran los portales ("1,2 M", "870K", "1.200") a número.
 * Se usa para poder ordenar por alcance después.
 *
 * Ojo con el separador: `1.2M` es un decimal (1,2 millones), pero `1.200` son mil
 * doscientos. Sacar todos los puntos convertiría el primero en 12 millones.
 */
export function parseMetricNumber(raw: string): number | undefined {
  const normalized = raw.trim().toLowerCase();
  const match = /^([\d.,]+)\s*([kmb])?/.exec(normalized);
  const digits = match?.[1];
  if (!digits) return undefined;

  const numeric = parseNumeric(digits);
  if (numeric === undefined) return undefined;

  const suffix = match?.[2];
  const multiplier = suffix === 'k' ? 1_000 : suffix === 'm' ? 1_000_000 : suffix === 'b' ? 1_000_000_000 : 1;
  return Math.round(numeric * multiplier);
}

function parseNumeric(digits: string): number | undefined {
  // Separador de miles: 1.200 / 12.345.678
  if (/^\d{1,3}(\.\d{3})+$/.test(digits)) return Number(digits.replace(/\./g, ''));
  // Separador de miles con coma: 1,200
  if (/^\d{1,3}(,\d{3})+$/.test(digits)) return Number(digits.replace(/,/g, ''));

  // Decimal con coma (es-CO): 1,5 → 1.5
  const value = Number(digits.includes(',') ? digits.replace(/\./g, '').replace(',', '.') : digits);
  return Number.isNaN(value) ? undefined : value;
}

/**
 * Fecha de un item: se prefiere el atributo máquina (`datetime`/`content`) antes
 * que el texto visible. "18 sep" sin año lo interpreta JavaScript como 2001 (¡y
 * sin avisar!), así que depender del texto es pedir un dato silenciosamente mal.
 */
function readDateLike(container: Selection, selector: string): string | null {
  const element = container.find(selector).first();
  const machine = element.attr('datetime') ?? element.attr('content');
  const value = text(machine ?? element.text());
  return value.length > 0 ? value : null;
}

/**
 * Una selección de cheerio. Se deriva del propio tipo de la librería para no
 * pelear con sus genéricos (ni recurrir a `any`).
 */
type Selection = ReturnType<cheerio.CheerioAPI>;

function pickText(container: Selection, selector?: string): string | null {
  if (!selector) return null;
  const value = text(container.find(selector).first().text());
  return value.length > 0 ? value : null;
}

function text(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function absolutize(href: string | undefined, baseUrl: string): string | null {
  if (!href || href.trim().length === 0) return null;
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

function toIsoDate(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
