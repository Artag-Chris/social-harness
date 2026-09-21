import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ZodValidationPipe } from './zod-validation.pipe';
import { z } from 'zod';

describe('ZodValidationPipe', () => {
  const schema = z.object({
    name: z.string().min(2),
    niche: z.array(z.string()).default([]),
  });

  it('devuelve el dato ya parseado (con defaults aplicados)', () => {
    const pipe = new ZodValidationPipe(schema);

    expect(pipe.transform({ name: 'Mi marca' })).toEqual({ name: 'Mi marca', niche: [] });
  });

  it('descarta claves desconocidas (equivalente a whitelist)', () => {
    const pipe = new ZodValidationPipe(schema);

    expect(pipe.transform({ name: 'Mi marca', colado: 'no debería pasar' })).toEqual({
      name: 'Mi marca',
      niche: [],
    });
  });

  it('con datos inválidos devuelve 400 con campo y motivo (no un dump del schema)', () => {
    const pipe = new ZodValidationPipe(schema);

    try {
      pipe.transform({ name: 'x' });
      throw new Error('debió fallar');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse() as {
        issues: Array<{ field: string; message: string }>;
      };
      expect(response.issues[0]?.field).toBe('name');
      expect(response.issues[0]?.message).toContain('2');
    }
  });

  it('reporta la ruta anidada del campo que falla', () => {
    const pipe = new ZodValidationPipe(z.object({ a: z.object({ b: z.number() }) }));

    try {
      pipe.transform({ a: { b: 'texto' } });
      throw new Error('debió fallar');
    } catch (error) {
      const response = (error as BadRequestException).getResponse() as {
        issues: Array<{ field: string }>;
      };
      expect(response.issues[0]?.field).toBe('a.b');
    }
  });

  it('no valida nada del `value` antes de parsear (no lanza por tipos raros)', () => {
    const pipe = new ZodValidationPipe(schema);

    expect(() => pipe.transform(null)).toThrow(BadRequestException);
    expect(() => pipe.transform('texto')).toThrow(BadRequestException);
    expect(vi.isMockFunction(pipe.transform)).toBe(false);
  });
});
