import type { EmbeddingProviderPort } from '../embedding-provider.port';

/**
 * Embeddings `mock`: vector determinístico derivado del hash del texto.
 *
 * Determinístico y no aleatorio a propósito: el mismo texto da SIEMPRE el mismo
 * vector, así los tests y el E2E pueden comprobar similitud y dedup sin red ni
 * gasto (un vector aleatorio haría que dos corridas dieran resultados distintos).
 *
 * Los vectores están normalizados a norma 1, que es lo que espera la distancia
 * coseno de pgvector: así el mock se comporta, métricamente, como uno real.
 */
export class MockEmbeddingsProvider implements EmbeddingProviderPort {
  readonly isMock = true;
  readonly name = 'mock';
  readonly model = 'mock-embeddings';

  constructor(readonly dimensions: number) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.vectorFor(text));
  }

  private vectorFor(text: string): number[] {
    const random = mulberry32(fnv1a(text));
    const vector: number[] = [];
    let sumOfSquares = 0;

    for (let index = 0; index < this.dimensions; index += 1) {
      // [-1, 1) — el mismo rango que un embedding normalizado real.
      const value = random() * 2 - 1;
      vector.push(value);
      sumOfSquares += value * value;
    }

    const norm = Math.sqrt(sumOfSquares) || 1;
    return vector.map((value) => value / norm);
  }
}

/** FNV-1a de 32 bits: hash estable y barato, suficiente para sembrar el PRNG. */
function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** PRNG sembrado (mulberry32): reproducible entre corridas y plataformas. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
