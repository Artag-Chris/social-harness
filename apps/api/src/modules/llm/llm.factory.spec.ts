import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { env } from '../../config/env';
import { createLlmProvider } from './llm.factory';
import { MockLlmProvider } from './mock/mock.provider';

/**
 * La factory es el punto donde "proveedor nuevo = registro", así que se prueba
 * que cada nombre produzca el adaptador correcto y que el modelo/base URL salgan
 * del `.env` (no de valores fijos en el código).
 */
describe('createLlmProvider', () => {
  it('deepseek usa el modelo y la base URL de la configuración', () => {
    const provider = createLlmProvider('deepseek', {
      ...env,
      DEEPSEEK_MODEL: 'deepseek-v4-flash',
      DEEPSEEK_API_KEY: 'llave',
    });

    expect(provider.name).toBe('deepseek');
    expect(provider.model).toBe('deepseek-v4-flash');
    expect(provider.isMock).toBe(false);
  });

  it('groq usa su propia configuración', () => {
    const provider = createLlmProvider('groq', {
      ...env,
      GROQ_MODEL: 'llama-3.3-70b-versatile',
      GROQ_API_KEY: 'llave',
    });

    expect(provider.name).toBe('groq');
    expect(provider.model).toBe('llama-3.3-70b-versatile');
  });

  it('mock no es IA real', () => {
    const provider = createLlmProvider('mock');

    expect(provider.isMock).toBe(true);
    expect(provider.name).toBe('mock');
  });

  it('un proveedor nuevo se agrega sin tocar el pipeline (mismo puerto)', () => {
    // Si mañana entra Kimi/Ollama, tiene que alcanzar con que cumpla el puerto.
    const provider = createLlmProvider('deepseek', { ...env, DEEPSEEK_API_KEY: 'llave' });
    const asPort: { name: string; model: string; isMock: boolean } = provider;

    expect(asPort.name).toBe('deepseek');
  });
});

describe('MockLlmProvider', () => {
  it('json() devuelve null: el llamador usa su respaldo determinístico', async () => {
    const provider = new MockLlmProvider();

    const output = await provider.json({
      system: 's',
      user: 'u',
      schema: z.object({ a: z.number() }),
      task: 't',
    });

    expect(output).toBeNull();
  });

  it('chat() avisa que es mock (no se puede confundir con una respuesta del modelo)', async () => {
    const provider = new MockLlmProvider();

    const output = await provider.chat({ system: 's', messages: [{ role: 'user', content: 'u' }] });

    expect(output.text).toContain('mock');
    expect(output.costUsd).toBe(0);
    expect(output.usage).toEqual({ inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 });
  });

  it('es "sano" y no toca la red', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    try {
      expect(await new MockLlmProvider().isHealthy()).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('integración factory + proveedor real (HTTP mockeado)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: 'deepseek-v4-flash',
          choices: [{ message: { content: '{"ok":true}' } }],
          usage: { prompt_tokens: 3, completion_tokens: 2 },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('usa la base URL del .env (cambiar de endpoint es configuración)', async () => {
    const provider = createLlmProvider('deepseek', {
      ...env,
      DEEPSEEK_API_KEY: 'llave',
      DEEPSEEK_BASE_URL: 'https://proxy-interno.local/v1',
    });

    await provider.chat({ system: 's', messages: [{ role: 'user', content: 'u' }] });

    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(
      'https://proxy-interno.local/v1/chat/completions',
    );
  });

  it('sin override usa la base URL pública de DeepSeek', async () => {
    const provider = createLlmProvider('deepseek', {
      ...env,
      DEEPSEEK_API_KEY: 'llave',
      DEEPSEEK_BASE_URL: '',
    });

    await provider.chat({ system: 's', messages: [{ role: 'user', content: 'u' }] });

    expect((fetchMock.mock.calls[0] as [string])[0]).toBe('https://api.deepseek.com/chat/completions');
  });

  it('json() valida de punta a punta contra el contrato del llamador', async () => {
    const provider = createLlmProvider('deepseek', { ...env, DEEPSEEK_API_KEY: 'llave' });

    const output = await provider.json({
      system: 's',
      user: 'u',
      schema: z.object({ ok: z.boolean() }),
      task: 'llm-check',
    });

    expect(output?.data).toEqual({ ok: true });
    expect(output?.meta.model).toBe('deepseek-v4-flash');
  });
});
