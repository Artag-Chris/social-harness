import { SignalKind, SourceKind } from '@prisma/client';
import { fetchPage } from '../engine/fetch-page';
import { parseRecipe, type RecipeDefinition } from '../engine/parse-recipe';
import { fetchOptionsFrom, toSignalDraft } from '../signal-mapping';
import type { ConnectorResult, SignalDraft } from '../signal-draft.schema';
import type { TrendConnectorContext, TrendConnectorPort } from '../trend-connector.port';

interface PublicWebParams {
  listUrl: string;
  recipe: RecipeDefinition;
}

/**
 * Conector de página pública con receta CSS: el comodín para las páginas que no
 * exponen API ni feed (tendencias de un portal, un blog sin RSS).
 *
 * Es el mismo motor que verifica el probe al guardar la fuente, así que lo que se
 * vio en la previsualización es lo que entra al pipeline.
 */
export class PublicWebConnector implements TrendConnectorPort {
  readonly kind = SourceKind.PUBLIC_WEB;
  readonly label = 'Página pública (receta CSS)';
  readonly isConfigured = true;

  async fetch(ctx: TrendConnectorContext, signal?: AbortSignal): Promise<ConnectorResult> {
    const params = readParams(ctx.params);
    const page = await fetchPage(params.listUrl, { ...fetchOptionsFrom(ctx.limits), signal });

    if (page.status >= 400) {
      throw new Error(`La página respondió HTTP ${page.status}.`);
    }

    const parsed = parseRecipe(page.body, params.recipe, page.finalUrl);
    const items = parsed.items
      .map((item) => toSignalDraft(item, { kind: SignalKind.TREND, baseUrl: page.finalUrl }))
      .filter((draft): draft is SignalDraft => draft !== null);

    return {
      items,
      warnings: [...parsed.warnings, ...parsed.diagnostics.filter((d) => d.matched === 0).map((d) => `El selector de "${d.field}" ("${d.selector}") no matcheó nada.`)],
      // El diagnóstico viaja a la corrida: sirve para entender por qué una fuente
      // dejó de traer señales sin abrir la página.
      diagnostics: parsed.diagnostics,
    };
  }
}

function readParams(params: Record<string, unknown>): PublicWebParams {
  const listUrl = params.listUrl;
  const recipe = params.recipe as RecipeDefinition | undefined;

  if (typeof listUrl !== 'string' || listUrl.length === 0) {
    throw new Error('La fuente de página pública no tiene `params.listUrl`.');
  }
  if (!recipe?.selectors?.item) {
    throw new Error('La receta no tiene el selector del contenedor (`recipe.selectors.item`).');
  }

  return { listUrl, recipe };
}
