import { Module } from '@nestjs/common';
import { JsonLogger } from './common/json-logger.service';
import { LoggingModule } from './common/logging.module';
import { AppConfigModule } from './modules/app-config/app-config.module';
import { AuthModule } from './modules/auth/auth.module';
import { ConnectorsModule } from './modules/connectors/connectors.module';
import { EmbeddingsModule } from './modules/embeddings/embeddings.module';
import { HealthModule } from './modules/health/health.module';
import { LlmModule } from './modules/llm/llm.module';
import { PlatformsModule } from './modules/platforms/platforms.module';
import { ProfilesModule } from './modules/profiles/profiles.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';
import { SignalsModule } from './modules/signals/signals.module';
import { SourcesModule } from './modules/sources/sources.module';
import { PrismaModule } from './prisma/prisma.module';

/**
 * Módulo raíz.
 *
 * Implementado: base de datos, auth (JWT de atiende), catálogo de redes y de
 * fuentes, perfiles con cuentas y objetivos, conectores que recolectan, scheduler
 * con BullMQ sobre la Redis compartida, ingestión con dedup, señales (lectura +
 * pegado manual) y la capa de IA resuelta por configuración.
 * Falta del plan: análisis de relevancia, ideas/calendario, borradores, métricas y
 * la pestaña del dashboard.
 */
@Module({
  imports: [
    PrismaModule,
    LoggingModule,
    AuthModule,
    HealthModule,
    AppConfigModule,
    PlatformsModule,
    ProfilesModule,
    SourcesModule,
    SignalsModule,
    ConnectorsModule,
    SchedulerModule,
    LlmModule,
    EmbeddingsModule,
  ],
  providers: [JsonLogger],
  exports: [JsonLogger],
})
export class AppModule {}
