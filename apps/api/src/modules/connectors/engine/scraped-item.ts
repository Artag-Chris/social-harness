/**
 * Item crudo que devuelve el motor de scraping (RSS o receta CSS).
 *
 * Es deliberadamente PERMISIVO: `url` puede venir vacío (una tarjeta sin enlace,
 * un item de feed sin link). El trabajo del motor es leer la página; decidir si un
 * item sirve es del conector, que lo convierte al contrato estricto `SignalDraft`
 * (donde `url` es obligatoria porque sin ella no hay dedup posible).
 *
 * Así, el probe puede mostrar "encontré esto" —aunque falte un dato— y el usuario
 * ve el problema en vez de un resultado vacío sin explicación.
 */
export interface ScrapedItem {
  title: string;
  /** Puede ser `''` si la tarjeta no tenía enlace. */
  url: string;
  author?: string | null;
  /** ISO 8601 o null. */
  publishedAt?: string | null;
  summary?: string | null;
  /** Métricas ya convertidas a número (views, likes…), si la fuente las trae. */
  metrics?: Record<string, number>;
  keywords?: string[];
}
