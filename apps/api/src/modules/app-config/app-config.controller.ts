import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { enabledConnectors, features } from '../../config/features';
import { env } from '../../config/env';

/**
 * Configuración efectiva para el dashboard.
 *
 * Para qué: la UI no hardcodea umbrales ni opciones. Los selectores de cadencia
 * salen de acá (en HORAS y con valores gruesos, que es como se piensan), y los
 * textos que dependen de flags ("la generación automática está apagada") también.
 *
 * No expone secretos: solo nombres de proveedor, flags y umbrales.
 */
@ApiTags('config')
@ApiBearerAuth()
@Controller('config')
export class AppConfigController {
  @Get()
  @ApiOperation({ summary: 'Flags, umbrales y opciones que usa la UI' })
  get(): Record<string, unknown> {
    return {
      llm: {
        provider: features.llm.provider,
        fallback: features.llm.fallback,
        model: features.llm.model,
        mock: features.llm.provider === 'mock',
      },
      embeddings: {
        provider: features.llm.embeddings,
        model: features.llm.embeddingsModel,
        mock: features.llm.embeddings === 'mock',
        // Si la similitud no es semántica, la UI lo puede advertir.
        semantic: features.llm.embeddings === 'openai',
      },
      ideas: {
        auto: features.ideas.auto,
        perWeek: features.ideas.perWeek,
        relevanceMinScore: features.ideas.relevanceMinScore,
        analyzeBatchSize: features.ideas.analyzeBatchSize,
      },
      scheduler: {
        intervalMinutes: features.scheduler.intervalMinutes,
        sourceDefaultIntervalHours: features.scheduler.sourceDefaultIntervalHours,
        // Opciones que ofrece la UI: gruesas y en horas (null = solo a mano).
        cadenceOptionsHours: [null, 1, 3, 6, 12, 24, 72, 168],
      },
      dedup: { enabled: features.dedup.enabled, intervalMinutes: features.dedup.intervalMinutes },
      notifications: { channels: features.notifications.channels },
      connectors: {
        enabled: enabledConnectors(features),
        // Qué conectores tienen sus credenciales: la UI avisa antes de que la
        // fuente falle en cada corrida.
        withCredentials: {
          YOUTUBE_API: env.YOUTUBE_API_KEY.length > 0,
          GOOGLE_TRENDS: true,
          RSS: true,
          PUBLIC_WEB: true,
          MANUAL: true,
        },
      },
      fixtures: { enabled: features.fixtures.enabled },
    };
  }
}
