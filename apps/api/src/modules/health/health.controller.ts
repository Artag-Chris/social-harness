import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { features } from '../../config/features';
import { PrismaService } from '../../prisma/prisma.service';
import { Public } from '../auth/public.decorator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Único endpoint **público**: lo llama el healthcheck del contenedor, que no
   * tiene sesión. Reporta el estado real de la base (no solo "el proceso vive") y
   * QUÉ proveedores de IA quedaron resueltos: sin eso, un pipeline
   * silenciosamente en `mock` es indistinguible de uno que funciona.
   *
   * No expone ninguna llave (solo nombres de proveedor y modelo) y NO llama a los
   * proveedores: sería una request externa cada 30 s por el healthcheck.
   */
  @Get()
  @Public()
  @ApiOperation({ summary: 'Estado del servicio, de la base y de los proveedores de IA' })
  async check(): Promise<{
    status: 'ok' | 'degraded';
    db: 'up' | 'down';
    llm: { provider: string; fallback: string | null; model: string };
    embeddings: { provider: string; model: string };
    uptimeSeconds: number;
    timestamp: string;
  }> {
    let db: 'up' | 'down' = 'down';
    try {
      // `$queryRaw` etiquetado (no `$queryRawUnsafe`): no hay motivo para usar la
      // variante sin escapar cuando la consulta es una constante.
      await this.prisma.$queryRaw`SELECT 1`;
      db = 'up';
    } catch {
      db = 'down';
    }

    return {
      status: db === 'up' ? 'ok' : 'degraded',
      db,
      llm: {
        provider: features.llm.provider,
        fallback: features.llm.fallback,
        model: features.llm.model,
      },
      embeddings: {
        provider: features.llm.embeddings,
        model: features.llm.embeddingsModel,
      },
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
