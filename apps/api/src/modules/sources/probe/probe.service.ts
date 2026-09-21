import { BadRequestException, Injectable } from '@nestjs/common';
import { SourceKind } from '@prisma/client';
import { z } from 'zod';
import { summarizeZodIssues } from '../../../common/zod-issues';
import { env } from '../../../config/env';
import { FetchError, fetchPage, type FetchedPage } from '../../connectors/engine/fetch-page';
import { parseFeed } from '../../connectors/engine/parse-feed';
import {
  parseRecipe,
  type RecipeDefinition,
  type SelectorDiagnostic,
} from '../../connectors/engine/parse-recipe';
import type { ScrapedItem } from '../../connectors/engine/scraped-item';
import { parseParams, type ProbeInput } from '../sources.schema';

interface RssParams {
  feedUrl: string;
  maxItems: number;
}

interface PublicWebParams {
  listUrl: string;
  recipe: RecipeDefinition;
}

/**
 * Verificación de una fuente ANTES de guardarla.
 *
 * Diseño: el probe **no falla**, informa. Si la página no responde o el selector
 * no encuentra nada, la respuesta trae `verified: false` y el motivo en
 * `warnings`, porque lo que el usuario necesita es el diagnóstico para corregir,
 * no un error genérico. Solo devuelve 400 si los `params` no tienen la forma del
 * tipo de fuente.
 *
 * Qué se puede verificar hoy: `RSS` y `PUBLIC_WEB` (no necesitan llaves ni la
 * infraestructura del pipeline). `YOUTUBE_API` y `GOOGLE_TRENDS` se validan en
 * forma y avisan que su verificación real llega con los conectores (fase 2).
 */

export interface ProbeResult {
  kind: SourceKind;
  /** `true` = además de responder, trajo items usables. */
  verified: boolean;
  itemsFound: number;
  preview: ScrapedItem[];
  warnings: string[];
  /** Por selector: cuántos items matcheó (para depurar una receta). */
  diagnostics?: SelectorDiagnostic[];
  fetched?: { status: number; contentType: string; bytes: number; finalUrl: string };
}

const PREVIEW_SIZE = 5;

@Injectable()
export class ProbeService {
  async probe(input: ProbeInput): Promise<ProbeResult> {
    const params = this.validateParams(input.kind, input.params);

    switch (input.kind) {
      case SourceKind.RSS:
        return this.probeRss(params as RssParams, input.limits);
      case SourceKind.PUBLIC_WEB:
        return this.probePublicWeb(params as PublicWebParams, input.limits);
      case SourceKind.MANUAL:
        return {
          kind: input.kind,
          verified: true,
          itemsFound: 0,
          preview: [],
          warnings: [
            'El tipo "manual" no trae nada solo: sirve para pegar inspiración o competencia desde el dashboard.',
          ],
        };
      case SourceKind.YOUTUBE_API:
        return this.cannotVerify(
          input.kind,
          env.YOUTUBE_API_KEY
            ? []
            : ['Falta `YOUTUBE_API_KEY` en el .env: la fuente va a avisar en cada corrida.'],
        );
      case SourceKind.GOOGLE_TRENDS:
        return this.cannotVerify(input.kind, []);
      default: {
        const unknown: never = input.kind;
        throw new BadRequestException(`Tipo de fuente desconocido: ${String(unknown)}`);
      }
    }
  }

  private async probeRss(params: RssParams, limits: ProbeInput['limits']): Promise<ProbeResult> {
    try {
      const page = await this.fetch(params.feedUrl, limits);
      if (page.status >= 400) {
        return this.failed(SourceKind.RSS, `El feed respondió HTTP ${page.status}.`, page);
      }

      const feed = await parseFeed(page.body);
      const warnings = [...feed.warnings];
      if (feed.items.length === 0) {
        warnings.push('El feed respondió bien pero no traía items.');
      }

      return {
        kind: SourceKind.RSS,
        verified: feed.items.length > 0,
        itemsFound: feed.items.length,
        preview: feed.items.slice(0, PREVIEW_SIZE),
        warnings,
        fetched: summarize(page),
      };
    } catch (error) {
      return this.failed(SourceKind.RSS, errorMessage(error));
    }
  }

  private async probePublicWeb(
    params: PublicWebParams,
    limits: ProbeInput['limits'],
  ): Promise<ProbeResult> {
    try {
      const page = await this.fetch(params.listUrl, limits);

      if (page.status >= 400) {
        return this.failed(
          SourceKind.PUBLIC_WEB,
          `La página respondió HTTP ${page.status}.`,
          page,
          looksLikeChallenge(page.body)
            ? 'Parece una protección anti-bot (challenge gestionado): conviene una fuente por API o RSS.'
            : undefined,
        );
      }

      const parsed = parseRecipe(page.body, params.recipe, page.finalUrl);
      const warnings = [...parsed.warnings];

      if (parsed.items.length === 0 && looksLikeChallenge(page.body)) {
        warnings.push(
          'La página devolvió un challenge anti-bot (Cloudflare/Turnstile): no hay HTML usable para recetas.',
        );
      }

      return {
        kind: SourceKind.PUBLIC_WEB,
        verified: parsed.items.length > 0,
        itemsFound: parsed.items.length,
        preview: parsed.items.slice(0, PREVIEW_SIZE),
        warnings,
        diagnostics: parsed.diagnostics,
        fetched: summarize(page),
      };
    } catch (error) {
      return this.failed(SourceKind.PUBLIC_WEB, errorMessage(error));
    }
  }

  /** Tipos que aún no se pueden verificar acá (necesitan su adaptador, fase 2). */
  private cannotVerify(kind: SourceKind, extraWarnings: string[]): ProbeResult {
    return {
      kind,
      verified: false,
      itemsFound: 0,
      preview: [],
      warnings: [
        'Los parámetros están bien formados, pero este tipo todavía no se puede verificar desde acá: ' +
          'su conector llega en la fase 2 (recolección).',
        ...extraWarnings,
      ],
    };
  }

  private failed(kind: SourceKind, warning: string, page?: FetchedPage, extra?: string): ProbeResult {
    return {
      kind,
      verified: false,
      itemsFound: 0,
      preview: [],
      warnings: [warning, ...(extra ? [extra] : [])],
      ...(page ? { fetched: summarize(page) } : {}),
    };
  }

  private fetch(url: string, limits: ProbeInput['limits']): Promise<FetchedPage> {
    return fetchPage(url, {
      timeoutMs: limits?.timeoutMs,
      userAgent: limits?.userAgent,
      headers: limits?.headers,
    });
  }

  /** Valida los params según el tipo y traduce el error de Zod a 400 con campos. */
  private validateParams(kind: SourceKind, params: unknown): unknown {
    try {
      return parseParams(kind, params);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new BadRequestException({
          message: `Los parámetros no corresponden al tipo ${kind}`,
          issues: summarizeZodIssues(error),
        });
      }
      throw error;
    }
  }
}

function summarize(page: FetchedPage): ProbeResult['fetched'] {
  return {
    status: page.status,
    contentType: page.contentType,
    bytes: page.bytes,
    finalUrl: page.finalUrl,
  };
}

/** Señales típicas de una página de challenge (Cloudflare y similares). */
export function looksLikeChallenge(body: string): boolean {
  const sample = body.slice(0, 5000).toLowerCase();
  return (
    sample.includes('challenges.cloudflare.com') ||
    sample.includes('cf-mitigated') ||
    sample.includes('just a moment') ||
    sample.includes('attention required') ||
    sample.includes('enable javascript and cookies to continue')
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof FetchError) return error.message;
  return error instanceof Error ? error.message : String(error);
}
