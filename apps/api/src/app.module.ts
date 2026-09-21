import { Module } from '@nestjs/common';
import { JsonLogger } from './common/json-logger.service';
import { EmbeddingsModule } from './modules/embeddings/embeddings.module';
import { HealthModule } from './modules/health/health.module';
import { LlmModule } from './modules/llm/llm.module';
import { PlatformsModule } from './modules/platforms/platforms.module';
import { PrismaModule } from './prisma/prisma.module';

/**
 * Módulo raíz.
 *
 * Fase 0 + fundaciones (actual): base de datos, health, el catálogo de redes y
 * la capa de IA con patrón adaptador (`LlmModule` + `EmbeddingsModule`), ya
 * resuelta desde el `.env` para que las fases siguientes solo inyecten puertos.
 * Las siguientes fases agregan, sin tocar esto más que para registrarlos:
 *   auth (JWT de atiende) · profiles · sources · connectors · scheduler ·
 *   ingestion · analysis · ideas · drafts · performance · notifications
 */
@Module({
  imports: [PrismaModule, HealthModule, LlmModule, EmbeddingsModule, PlatformsModule],
  providers: [JsonLogger],
  exports: [JsonLogger],
})
export class AppModule {}
