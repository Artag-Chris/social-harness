import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { LlmHttpError, LlmInvalidJsonError } from '../llm.errors';
import {
  extractProviderMessage,
  OpenAiCompatibleProvider,
  parseJsonLoosely,
  stripCodeFence,
  type OpenAiCompatibleConfig,
} from './openai-compatible.provider';

const BASE_CONFIG: OpenAiCompatibleConfig = {
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com',
  apiKey: 'llave-de-prueba',
  model: 'deepseek-chat',
  timeoutMs: 5000,
  maxRetries: 2,
  defaultMaxTokens: 4096,
  retryBaseDelayMs: 1,
};

function provider(overrides: Partial<OpenAiCompatibleConfig> = {}): OpenAiCompatibleProvider {
  return new OpenAiCompatibleProvider({ ...BASE_CONFIG, ...overrides });
}

/** Respuesta exitosa con la forma real de la API de chat completions. */
function okResponse(overrides: Record<string, unknown> = {}): Response {
  const body = {
    id: 'chatcmpl-1',
    model: 'deepseek-chat',
    choices: [{ message: { role: 'assistant', content: 'hola' } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
    ...overrides,
  };
  return new Response(JSON.stringify(body), { status: 200 });
}

function errorResponse(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
}

describe('OpenAiCompatibleProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('arma el body con system primero, el modelo y el tope de tokens', async () => {
    fetchMock.mockResolvedValue(okResponse());

    await provider().chat({
      system: 'Sos un coach de redes.',
      messages: [{ role: 'user', content: 'dame ideas' }],
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer llave-de-prueba');

    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('deepseek-chat');
    expect(body.messages).toEqual([
      { role: 'system', content: 'Sos un coach de redes.' },
      { role: 'user', content: 'dame ideas' },
    ]);
    expect(body.max_tokens).toBe(4096);
    expect(body.stream).toBe(false);
    // Sin `json: true` no se manda response_format (no todos los modelos lo aceptan).
    expect(body.response_format).toBeUndefined();
  });

  it('pide modo JSON solo cuando se lo piden', async () => {
    fetchMock.mockResolvedValue(okResponse());

    await provider().chat({ system: 's', messages: [{ role: 'user', content: 'u' }], json: true });

    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('devuelve el usage, el modelo del proveedor y el costo estimado', async () => {
    fetchMock.mockResolvedValue(okResponse());

    const result = await provider().chat({ system: 's', messages: [{ role: 'user', content: 'u' }] });

    expect(result.text).toBe('hola');
    expect(result.provider).toBe('deepseek');
    expect(result.model).toBe('deepseek-chat');
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 });
    expect(result.costUsd).toBeGreaterThan(0);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('lee los tokens cacheados en las dos formas que usan los proveedores', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({ usage: { prompt_tokens: 100, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 40 } } }),
    );
    fetchMock.mockResolvedValueOnce(
      okResponse({ usage: { prompt_tokens: 100, completion_tokens: 1, prompt_cache_hit_tokens: 70 } }),
    );

    const first = await provider().chat({ system: 's', messages: [{ role: 'user', content: 'u' }] });
    const second = await provider().chat({ system: 's', messages: [{ role: 'user', content: 'u' }] });

    expect(first.usage.cachedInputTokens).toBe(40);
    expect(second.usage.cachedInputTokens).toBe(70);
  });

  it('si el proveedor contesta error, tira LlmHttpError con el motivo del cuerpo', async () => {
    fetchMock.mockResolvedValue(errorResponse(401, { error: { message: 'Authentication Fails' } }));

    // 401 no es reintentable: una sola llamada.
    await expect(provider().chat({ system: 's', messages: [{ role: 'user', content: 'u' }] })).rejects.toThrow(
      /Authentication Fails/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reintenta en errores transitorios y termina bien', async () => {
    fetchMock
      .mockResolvedValueOnce(errorResponse(429, { error: { message: 'rate limit' } }))
      .mockResolvedValueOnce(okResponse());

    const result = await provider().chat({ system: 's', messages: [{ role: 'user', content: 'u' }] });

    expect(result.text).toBe('hola');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('se rinde después de agotar los reintentos y reporta el último fallo', async () => {
    fetchMock.mockResolvedValue(errorResponse(503, { error: { message: 'unavailable' } }));

    await expect(
      provider({ maxRetries: 1 }).chat({ system: 's', messages: [{ role: 'user', content: 'u' }] }),
    ).rejects.toThrow(LlmHttpError);
    expect(fetchMock).toHaveBeenCalledTimes(2); // intento inicial + 1 reintento
  });

  it('traduce el timeout a un error legible (status 0)', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    fetchMock.mockRejectedValue(abort);

    await expect(
      provider({ maxRetries: 0 }).chat({ system: 's', messages: [{ role: 'user', content: 'u' }] }),
    ).rejects.toThrow(/tiempo agotado \(5000 ms\)/);
  });

  it('si el modelo no soporta modo JSON, reintenta SIN él en vez de fallar', async () => {
    fetchMock
      .mockResolvedValueOnce(
        errorResponse(400, { error: { message: 'response_format is not supported by this model' } }),
      )
      .mockResolvedValueOnce(okResponse({ choices: [{ message: { content: '{"ok":true}' } }] }));

    const result = await provider({ model: 'modelo-sin-json' }).chat({
      system: 's',
      messages: [{ role: 'user', content: 'u' }],
      json: true,
    });

    expect(result.text).toBe('{"ok":true}');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body));
    expect(secondBody.response_format).toBeUndefined();
  });

  it('json(): valida con el schema y devuelve datos tipados', async () => {
    fetchMock.mockResolvedValue(
      okResponse({ choices: [{ message: { content: '{"platform":"TIKTOK","score":82}' } }] }),
    );
    const schema = z.object({ platform: z.enum(['TIKTOK', 'INSTAGRAM']), score: z.number() });

    const result = await provider().json({
      system: 's',
      user: 'puntuá esto',
      schema,
      task: 'analyze-signals',
      hint: '{ platform, score }',
    });

    expect(result?.data).toEqual({ platform: 'TIKTOK', score: 82 });
    expect(result?.meta.provider).toBe('deepseek');
  });

  it('json(): el prompt pide la palabra "json" y el contrato (DeepSeek lo exige)', async () => {
    fetchMock.mockResolvedValue(okResponse({ choices: [{ message: { content: '{"ok":true}' } }] }));

    await provider().json({
      system: 's',
      user: 'algo',
      schema: z.object({ ok: z.boolean() }),
      task: 't',
      hint: '{ ok: boolean }',
    });

    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    const userContent = body.messages[1].content as string;
    expect(userContent).toContain('json');
    expect(userContent).toContain('{ ok: boolean }');
  });

  it('json(): tolera fences de markdown y texto alrededor del objeto', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({ choices: [{ message: { content: '```json\n{"ok":true}\n```' } }] }),
    );
    fetchMock.mockResolvedValueOnce(
      okResponse({ choices: [{ message: { content: 'Claro, acá va:\n{"ok":true}\nEso es todo.' } }] }),
    );

    const schema = z.object({ ok: z.boolean() });

    expect((await provider().json({ system: 's', user: 'u', schema, task: 't' }))?.data).toEqual({
      ok: true,
    });
    expect((await provider().json({ system: 's', user: 'u', schema, task: 't' }))?.data).toEqual({
      ok: true,
    });
  });

  it('json(): si no cumple el contrato, tira LlmInvalidJsonError con el campo que falló', async () => {
    fetchMock.mockResolvedValue(
      okResponse({ choices: [{ message: { content: '{"score":"ochenta"}' } }] }),
    );

    await expect(
      provider().json({ system: 's', user: 'u', schema: z.object({ score: z.number() }), task: 'ideas' }),
    ).rejects.toThrow(/ideas.*score/s);
  });

  it('json(): si no es JSON, tira LlmInvalidJsonError (no un SyntaxError suelto)', async () => {
    fetchMock.mockResolvedValue(okResponse({ choices: [{ message: { content: 'no tengo idea' } }] }));

    await expect(
      provider().json({ system: 's', user: 'u', schema: z.object({}), task: 't' }),
    ).rejects.toThrow(LlmInvalidJsonError);
  });

  it('isHealthy() consulta /models', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    expect(await provider().isHealthy()).toBe(true);

    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 500 }));
    expect(await provider().isHealthy()).toBe(false);

    fetchMock.mockRejectedValueOnce(new Error('sin red'));
    expect(await provider().isHealthy()).toBe(false);
  });

  it('usa la base URL configurada (cambiar de endpoint no toca código)', async () => {
    fetchMock.mockResolvedValue(okResponse());

    await provider({ baseUrl: 'https://otro-proveedor.local/v1' }).chat({
      system: 's',
      messages: [{ role: 'user', content: 'u' }],
    });

    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      'https://otro-proveedor.local/v1/chat/completions',
    );
  });
});

describe('helpers de parseo', () => {
  it('extractProviderMessage saca el motivo de JSON, texto y HTML', () => {
    expect(extractProviderMessage('{"error":{"message":"boom"}}', 400)).toBe('boom');
    expect(extractProviderMessage('{"message":"simple"}', 400)).toBe('simple');
    expect(extractProviderMessage('<html><body>Bad <b>Gateway</b></body></html>', 502)).toBe(
      'Bad Gateway',
    );
    expect(extractProviderMessage('', 500)).toBe('HTTP 500 sin detalle');
  });

  it('stripCodeFence quita solo el fence que envuelve todo', () => {
    expect(stripCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripCodeFence('```\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripCodeFence('{"a":1}')).toBe('{"a":1}');
  });

  it('parseJsonLoosely encuentra el objeto aunque venga con texto', () => {
    expect(parseJsonLoosely('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseJsonLoosely('Listo: {"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseJsonLoosely('nada')).toEqual({ ok: false });
  });
});
