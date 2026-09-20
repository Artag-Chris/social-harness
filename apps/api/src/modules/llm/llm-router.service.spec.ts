import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { LlmHttpError, LlmInvalidJsonError, LlmUnavailableError } from './llm.errors';
import type { LlmProviderPort, LlmResult } from './llm-provider.port';
import { LlmRouterService } from './llm-router.service';

const schema = z.object({ ok: z.boolean() });

function result(provider: string): LlmResult {
  return {
    text: `respuesta de ${provider}`,
    provider,
    model: 'modelo',
    usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
    costUsd: 0,
    latencyMs: 1,
  };
}

function stub(name: string, overrides: Partial<LlmProviderPort> = {}): LlmProviderPort {
  return {
    name,
    model: 'modelo',
    isMock: false,
    chat: vi.fn().mockResolvedValue(result(name)),
    json: vi.fn().mockResolvedValue({ data: { ok: true }, meta: result(name) }),
    isHealthy: vi.fn().mockResolvedValue(true),
    ...overrides,
  } as LlmProviderPort;
}

/**
 * El router es lo que hace que "cambiar de proveedor" no sea un refactor y que
 * un proveedor caído no tumbe el ciclo. Se prueba la cadena de decisión entera.
 */
describe('LlmRouterService', () => {
  it('usa el principal cuando funciona', async () => {
    const primary = stub('deepseek');
    const fallback = stub('groq');
    const router = new LlmRouterService(primary, fallback);

    const output = await router.chat({ system: 's', messages: [{ role: 'user', content: 'u' }] });

    expect(output.provider).toBe('deepseek');
    expect(primary.chat).toHaveBeenCalledTimes(1);
    expect(fallback.chat).not.toHaveBeenCalled();
  });

  it('si el principal falla, contesta el respaldo (y el resultado dice quién contestó)', async () => {
    const primary = stub('deepseek', { chat: vi.fn().mockRejectedValue(new LlmHttpError('deepseek', 503, 'caído')) });
    const fallback = stub('groq');
    const router = new LlmRouterService(primary, fallback);

    const output = await router.chat({ system: 's', messages: [{ role: 'user', content: 'u' }] });

    expect(output.provider).toBe('groq');
  });

  it('si fallan los dos, el error dice POR QUÉ falló cada uno', async () => {
    const primary = stub('deepseek', { chat: vi.fn().mockRejectedValue(new LlmHttpError('deepseek', 503, 'sin cuota')) });
    const fallback = stub('groq', { chat: vi.fn().mockRejectedValue(new LlmHttpError('groq', 429, 'rate limit')) });
    const router = new LlmRouterService(primary, fallback);

    await expect(
      router.chat({ system: 's', messages: [{ role: 'user', content: 'u' }] }),
    ).rejects.toThrow(/deepseek: sin cuota[\s\S]*groq: rate limit/);
  });

  it('sin respaldo configurado, propaga el error del principal', async () => {
    const router = new LlmRouterService(
      stub('deepseek', { chat: vi.fn().mockRejectedValue(new LlmHttpError('deepseek', 500, 'boom')) }),
      null,
    );

    await expect(
      router.chat({ system: 's', messages: [{ role: 'user', content: 'u' }] }),
    ).rejects.toThrow(/boom/);
  });

  it('json(): en mock devuelve null sin intentar nada (señal de "usá tu respaldo")', async () => {
    const primary = stub('mock', { isMock: true, json: vi.fn().mockResolvedValue(null) });
    const router = new LlmRouterService(primary, null);

    const output = await router.json({ system: 's', user: 'u', schema, task: 't' });

    expect(output).toBeNull();
    expect(primary.json).not.toHaveBeenCalled();
  });

  it('json(): un JSON que no cumple el contrato hace caer al respaldo', async () => {
    // Este es el caso real: el modelo contesta algo que no valida. Otro proveedor
    // puede cumplirlo, así que se intenta antes de darse por vencido.
    const primary = stub('deepseek', {
      json: vi.fn().mockRejectedValue(new LlmInvalidJsonError('deepseek', 'no cumple el contrato')),
    });
    const fallback = stub('groq');
    const router = new LlmRouterService(primary, fallback);

    const output = await router.json({ system: 's', user: 'u', schema, task: 't' });

    expect(output?.meta.provider).toBe('groq');
  });

  it('json(): si los dos fallan, tira LlmUnavailableError con los dos motivos', async () => {
    const router = new LlmRouterService(
      stub('deepseek', { json: vi.fn().mockRejectedValue(new LlmInvalidJsonError('deepseek', 'json roto')) }),
      stub('groq', { json: vi.fn().mockRejectedValue(new LlmHttpError('groq', 429, 'sin cuota')) }),
    );

    await expect(router.json({ system: 's', user: 'u', schema, task: 't' })).rejects.toThrow(
      LlmUnavailableError,
    );
  });

  it('expone qué quedó configurado (para el log y /config)', () => {
    const router = new LlmRouterService(stub('deepseek'), stub('groq'));

    expect(router.name).toBe('router');
    expect(router.primaryName).toBe('deepseek');
    expect(router.fallbackName).toBe('groq');
    expect(router.isMock).toBe(false);
  });

  it('isHealthy() alcanza con que uno de los dos esté sano', async () => {
    const unhealthy = stub('deepseek', { isHealthy: vi.fn().mockResolvedValue(false) });
    const healthy = stub('groq', { isHealthy: vi.fn().mockResolvedValue(true) });
    expect(await new LlmRouterService(unhealthy, healthy).isHealthy()).toBe(true);

    const alsoUnhealthy = stub('groq', { isHealthy: vi.fn().mockResolvedValue(false) });
    expect(await new LlmRouterService(unhealthy, alsoUnhealthy).isHealthy()).toBe(false);

    expect(await new LlmRouterService(unhealthy, null).isHealthy()).toBe(false);
  });
});
