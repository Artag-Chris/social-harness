import { describe, expect, it } from 'vitest';
import { parseEnv, formatEnvIssues } from './env';
import { z } from 'zod';

/**
 * Estos tests fijan las reglas que más fácil se rompen con el tiempo:
 * el parseo de booleanos y la resolución de proveedores `auto`.
 */
describe('parseEnv', () => {
  it('arranca con defaults sin ninguna variable (dev local)', () => {
    const env = parseEnv({});
    expect(env.PORT).toBe(3200);
    expect(env.QUEUE_PREFIX).toBe('socialharness');
    expect(env.AUTO_IDEAS_ENABLED).toBe(true);
    expect(env.FIXTURE_ENABLED).toBe(false);
    expect(env.RESPECT_ROBOTS).toBe(true);
  });

  it('parsea "false" como false (no con z.coerce.boolean, que daría true)', () => {
    const env = parseEnv({ AUTO_IDEAS_ENABLED: 'false', DEDUP_ENABLED: 'false', FIXTURE_ENABLED: 'true' });
    expect(env.AUTO_IDEAS_ENABLED).toBe(false);
    expect(env.DEDUP_ENABLED).toBe(false);
    expect(env.FIXTURE_ENABLED).toBe(true);
  });

  it('resuelve llmMode auto: deepseek > groq > mock', () => {
    expect(parseEnv({}).llmMode).toBe('mock');
    expect(parseEnv({ GROQ_API_KEY: 'g' }).llmMode).toBe('groq');
    expect(parseEnv({ GROQ_API_KEY: 'g', DEEPSEEK_API_KEY: 'd' }).llmMode).toBe('deepseek');
  });

  it('respeta LLM_PROVIDER=mock aunque haya llaves (modo E2E sin gasto)', () => {
    expect(parseEnv({ LLM_PROVIDER: 'mock', DEEPSEEK_API_KEY: 'd' }).llmMode).toBe('mock');
  });

  it('resuelve embedMode: sin OPENAI_API_KEY cae a mock', () => {
    expect(parseEnv({}).embedMode).toBe('mock');
    expect(parseEnv({ OPENAI_API_KEY: 'k' }).embedMode).toBe('openai');
  });

  it('deriva la conexión de Redis desde REDIS_HOST (Redis compartida)', () => {
    expect(parseEnv({ REDIS_HOST: 'redis', REDIS_PORT: '6379' }).REDIS_URL).toBe('redis://redis:6379');
    expect(parseEnv({ REDIS_URL: 'redis://otra:6380' }).REDIS_URL).toBe('redis://otra:6380');
  });

  it('parsea NOTIFY_CHANNELS a lista', () => {
    expect(parseEnv({ NOTIFY_CHANNELS: 'dashboard, whatsapp' }).notifyChannels).toEqual([
      'dashboard',
      'whatsapp',
    ]);
  });

  it('falla si se pide un proveedor explícito sin su llave', () => {
    expect(() => parseEnv({ LLM_PROVIDER: 'deepseek' })).toThrow(z.ZodError);
    expect(() => parseEnv({ EMBEDDING_PROVIDER: 'openai' })).toThrow(z.ZodError);
  });

  it('formatea los errores con la variable que falla', () => {
    try {
      parseEnv({ LLM_PROVIDER: 'groq' });
      throw new Error('debió fallar');
    } catch (error) {
      const message = formatEnvIssues(error as z.ZodError);
      expect(message).toContain('GROQ_API_KEY');
      expect(message).toContain('LLM_PROVIDER');
    }
  });

  it('rechaza un RELEVANCE_MIN_SCORE fuera de rango', () => {
    expect(() => parseEnv({ RELEVANCE_MIN_SCORE: '150' })).toThrow(z.ZodError);
  });
});

/**
 * Las URLs se validan en el boot: si no, un `REDIS_URL` mal escrito explota
 * después en un `new URL()` durante el import de otro módulo, sin decir qué
 * variable está mal.
 */
describe('parseEnv — URLs', () => {
  it('acepta URLs válidas', () => {
    expect(parseEnv({ REDIS_URL: 'redis://user:pass@host:6380/0' }).REDIS_URL).toBe(
      'redis://user:pass@host:6380/0',
    );
    expect(parseEnv({ FIXTURE_BASE_URL: 'http://socialharness-fixture' }).FIXTURE_BASE_URL).toBe(
      'http://socialharness-fixture',
    );
  });

  it('falla con una URL inválida, nombrando la variable', () => {
    expect(() => parseEnv({ REDIS_URL: 'no-es-una-url' })).toThrow(z.ZodError);
    expect(() => parseEnv({ FIXTURE_BASE_URL: 'tampoco' })).toThrow(z.ZodError);
  });
});

describe('parseEnv — listas', () => {
  it('parsea FEATURE_CONNECTORS y CORS_ALLOWED_ORIGINS sin entradas vacías', () => {
    const env = parseEnv({
      FEATURE_CONNECTORS: 'RSS, , PUBLIC_WEB',
      CORS_ALLOWED_ORIGINS: 'https://a.com, https://b.com',
    });
    expect(env.connectorKinds).toEqual(['RSS', 'PUBLIC_WEB']);
    expect(env.corsAllowedOrigins).toEqual(['https://a.com', 'https://b.com']);
  });

  it('por defecto habilita los cinco conectores y CORS abierto', () => {
    const env = parseEnv({});
    expect(env.connectorKinds).toHaveLength(5);
    expect(env.corsAllowedOrigins).toEqual(['*']);
  });
});

/**
 * El respaldo de IA es lo que evita que un proveedor caído deje el pipeline sin
 * ideas, así que su resolución se fija con tests.
 */
describe('parseEnv — respaldo de IA', () => {
  it('auto elige el otro proveedor que tenga llave (groq primero)', () => {
    const both = parseEnv({ DEEPSEEK_API_KEY: 'd', GROQ_API_KEY: 'g' });
    expect(both.llmMode).toBe('deepseek');
    expect(both.llmFallback).toBe('groq');

    const groqOnly = parseEnv({ GROQ_API_KEY: 'g' });
    expect(groqOnly.llmMode).toBe('groq');
    expect(groqOnly.llmFallback).toBeNull();
  });

  it('con un solo proveedor configurado no inventa un respaldo', () => {
    expect(parseEnv({ DEEPSEEK_API_KEY: 'd' }).llmFallback).toBeNull();
    expect(parseEnv({}).llmFallback).toBeNull();
  });

  it('nunca elige como respaldo al mismo proveedor que el principal', () => {
    const env = parseEnv({ LLM_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'd', GROQ_API_KEY: 'g' });
    expect(env.llmFallback).toBe('groq');
  });

  it('LLM_FALLBACK=none lo apaga', () => {
    expect(parseEnv({ DEEPSEEK_API_KEY: 'd', GROQ_API_KEY: 'g', LLM_FALLBACK: 'none' }).llmFallback).toBeNull();
  });

  it('un respaldo explícito sin llave es un error de configuración', () => {
    expect(() => parseEnv({ LLM_FALLBACK: 'groq' })).toThrow(z.ZodError);
  });
});

describe('parseEnv — embeddings y precios', () => {
  it('falla si EMBEDDING_DIMENSIONS no coincide con la columna vector(1536)', () => {
    // Cambiar de modelo sin migrar el schema dejaría vectores incompatibles.
    expect(() => parseEnv({ EMBEDDING_DIMENSIONS: '768' })).toThrow(z.ZodError);
    expect(parseEnv({ EMBEDDING_DIMENSIONS: '1536' }).EMBEDDING_DIMENSIONS).toBe(1536);
  });

  it('los precios opcionales quedan en undefined si están vacíos (no en 0)', () => {
    const withEmpty = parseEnv({ LLM_PRICE_INPUT_PER_1M: '', LLM_PRICE_OUTPUT_PER_1M: '' });
    expect(withEmpty.LLM_PRICE_INPUT_PER_1M).toBeUndefined();
    expect(withEmpty.LLM_PRICE_OUTPUT_PER_1M).toBeUndefined();

    const withValues = parseEnv({ LLM_PRICE_INPUT_PER_1M: '0.3', LLM_PRICE_OUTPUT_PER_1M: '1.2' });
    expect(withValues.LLM_PRICE_INPUT_PER_1M).toBe(0.3);
    expect(withValues.LLM_PRICE_OUTPUT_PER_1M).toBe(1.2);
  });

  it('trae los defaults de timeout/reintentos/tokens', () => {
    const env = parseEnv({});
    expect(env.LLM_TIMEOUT_MS).toBe(60000);
    expect(env.LLM_MAX_RETRIES).toBe(2);
    expect(env.LLM_MAX_TOKENS).toBe(4096);
    expect(env.EMBEDDING_BATCH_SIZE).toBe(100);
  });
});
