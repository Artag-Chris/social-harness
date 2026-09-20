import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../config/env';
import { EmbeddingError } from './embedding-provider.port';
import { createEmbeddingProvider } from './embeddings.factory';
import { MockEmbeddingsProvider } from './mock/mock-embeddings.provider';
import { OpenAiEmbeddingsProvider } from './openai/openai-embeddings.provider';

describe('MockEmbeddingsProvider', () => {
  const provider = new MockEmbeddingsProvider(1536);

  it('es determinístico: el mismo texto da SIEMPRE el mismo vector', async () => {
    // Sin esto, la similitud y el dedup darían distinto en cada corrida y los
    // tests del pipeline serían inestables.
    const [first] = await provider.embed(['cómo hacer un reel que retenga']);
    const [second] = await provider.embed(['cómo hacer un reel que retenga']);

    expect(first).toEqual(second);
  });

  it('textos distintos dan vectores distintos', async () => {
    const [a] = await provider.embed(['una cosa']);
    const [b] = await provider.embed(['otra cosa completamente distinta']);

    expect(a).not.toEqual(b);
  });

  it('respeta las dimensiones de la columna y normaliza el vector', async () => {
    const [vector] = await provider.embed(['prueba']);

    expect(vector).toHaveLength(1536);
    const norm = Math.sqrt(vector!.reduce((sum, value) => sum + value * value, 0));
    expect(norm).toBeCloseTo(1, 6);
  });

  it('devuelve un vector por texto y respeta el orden', async () => {
    const vectors = await provider.embed(['a', 'b', 'c']);

    expect(vectors).toHaveLength(3);
    expect(vectors[0]).toEqual((await provider.embed(['a']))[0]);
  });

  it('sin textos no devuelve nada (no llama a nadie)', async () => {
    expect(await provider.embed([])).toEqual([]);
  });
});

describe('OpenAiEmbeddingsProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  function config(overrides: Partial<typeof env> = {}): typeof env {
    return { ...env, OPENAI_API_KEY: 'llave', EMBEDDING_DIMENSIONS: 1536, EMBEDDING_BATCH_SIZE: 2, ...overrides };
  }

  function vectorsResponse(count: number, dimensions = 1536, shuffle = false): Response {
    const data = Array.from({ length: count }, (_, index) => ({
      index,
      embedding: Array.from({ length: dimensions }, () => 0.1),
    }));
    return new Response(JSON.stringify({ data: shuffle ? [...data].reverse() : data }), { status: 200 });
  }

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('manda el modelo y los textos, y devuelve los vectores', async () => {
    fetchMock.mockResolvedValue(vectorsResponse(1));

    const provider = new OpenAiEmbeddingsProvider(config());
    const vectors = await provider.embed(['hola']);

    expect(vectors).toHaveLength(1);
    expect(vectors[0]).toHaveLength(1536);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/embeddings');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer llave');
    expect(JSON.parse(String(init.body))).toEqual({ model: env.EMBEDDING_MODEL, input: ['hola'] });
  });

  it('parte en lotes según EMBEDDING_BATCH_SIZE', async () => {
    fetchMock
      .mockResolvedValueOnce(vectorsResponse(2))
      .mockResolvedValueOnce(vectorsResponse(1));

    const vectors = await new OpenAiEmbeddingsProvider(config()).embed(['a', 'b', 'c']);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vectors).toHaveLength(3);
    const secondBody = JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body));
    expect(secondBody.input).toEqual(['c']);
  });

  it('ordena por `index` aunque la API los devuelva desordenados', async () => {
    fetchMock.mockResolvedValue(vectorsResponse(3, 1536, true));

    const vectors = await new OpenAiEmbeddingsProvider(config({ EMBEDDING_BATCH_SIZE: 10 })).embed([
      'a',
      'b',
      'c',
    ]);

    expect(vectors).toHaveLength(3);
  });

  it('si la dimensión no coincide con la columna, falla ruidosamente', async () => {
    // Guardar un vector de otra dimensión rompería la búsqueda por similitud (y
    // en silencio, porque el error aparecería mucho después).
    fetchMock.mockResolvedValue(vectorsResponse(1, 768));

    await expect(
      new OpenAiEmbeddingsProvider(config()).embed(['hola']),
    ).rejects.toThrow(/768 dimensiones y se esperaban 1536/);
  });

  it('si llegan menos vectores que textos, falla en vez de desalinear', async () => {
    fetchMock.mockResolvedValue(vectorsResponse(1));

    await expect(
      new OpenAiEmbeddingsProvider(config()).embed(['a', 'b']),
    ).rejects.toThrow(EmbeddingError);
  });

  it('propaga el motivo del error del proveedor', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Incorrect API key provided' } }), { status: 401 }),
    );

    await expect(new OpenAiEmbeddingsProvider(config()).embed(['hola'])).rejects.toThrow(
      /Incorrect API key provided/,
    );
  });

  it('traduce el timeout a un error legible', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    fetchMock.mockRejectedValue(abort);

    await expect(new OpenAiEmbeddingsProvider(config()).embed(['hola'])).rejects.toThrow(
      /tiempo agotado/,
    );
  });
});

describe('createEmbeddingProvider', () => {
  it('resuelve cada modo a su adaptador', () => {
    expect(createEmbeddingProvider('mock', env).isMock).toBe(true);
    expect(createEmbeddingProvider('openai', { ...env, OPENAI_API_KEY: 'llave' }).isMock).toBe(false);
  });

  it('el mock respeta las dimensiones configuradas', async () => {
    const provider = createEmbeddingProvider('mock', { ...env, EMBEDDING_DIMENSIONS: 1536 });

    expect(provider.dimensions).toBe(1536);
    expect((await provider.embed(['x']))[0]).toHaveLength(1536);
  });
});
