import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service';
import { HealthController } from './health.controller';

function controllerWith(queryRaw: () => Promise<unknown>): HealthController {
  const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
  return new HealthController(prisma);
}

describe('HealthController', () => {
  it('con la base arriba responde ok y reporta los proveedores de IA', async () => {
    const controller = controllerWith(vi.fn().mockResolvedValue([{ '?column?': 1 }]));

    const result = await controller.check();

    expect(result.status).toBe('ok');
    expect(result.db).toBe('up');
    expect(['deepseek', 'groq', 'mock']).toContain(result.llm.provider);
    expect(['deepseek', 'groq', null]).toContain(result.llm.fallback);
    expect(result.llm.model.length).toBeGreaterThan(0);
    expect(['openai', 'mock']).toContain(result.embeddings.provider);
    expect(Number.isNaN(Date.parse(result.timestamp))).toBe(false);
  });

  it('NO expone llaves: solo nombres de proveedor y modelo', async () => {
    const controller = controllerWith(vi.fn().mockResolvedValue([]));

    const serialized = JSON.stringify(await controller.check());

    expect(serialized).not.toMatch(/sk-|gsk_|api[_-]?key/i);
  });

  it('con la base caída responde degraded en vez de romper el endpoint', async () => {
    // Es el caso que importa para el HEALTHCHECK del contenedor: si el health
    // tirara 500, Docker no podría distinguir "proceso vivo pero sin base" de
    // "proceso muerto".
    const controller = controllerWith(vi.fn().mockRejectedValue(new Error('P1001')));

    const result = await controller.check();

    expect(result.status).toBe('degraded');
    expect(result.db).toBe('down');
  });
});
