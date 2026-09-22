import { Module } from '@nestjs/common';
import { JsonLogger } from './common/json-logger.service';
import { LoggingModule } from './common/logging.module';
import { AnalysisModule } from './modules/analysis/analysis.module';
import { AppConfigModule } from './modules/app-config/app-config.module';
import { AuthModule } from './modules/auth/auth.module';
import { ConnectorsModule } from './modules/connectors/connectors.module';
import { EmbeddingsModule } from './modules/embeddings/embeddings.module';
import { HealthModule } from './modules/health/health.module';
import { IdeasModule } from './modules/ideas/ideas.module';
import { LlmModule } from './modules/llm/llm.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PlatformsModule } from './modules/platforms/platforms.module';
import { ProfilesModule } from './modules/profiles/profiles.module';
import { QueueModule } from './modules/queue/queue.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';
import { SignalsModule } from './modules/signals/signals.module';
import { SourcesModule } from './modules/sources/sources.module';
import { PrismaModule } from './prisma/prisma.module';

/**
 * Módulo raíz.
 *
 * Implementado: base de datos, auth (JWT de atiende), catálogos de redes y fuentes,
 * perfiles con cuentas y objetivos, conectores que recolectan, scheduler con BullMQ,
 * ingestión con dedup, señales (lectura + pegado manual), análisis de relevancia con
 * prefilter determinístico, ideas con calendario y la bandeja de avisos.
 * Falta del plan: borradores a demanda, métricas/rendimiento y la pestaña del
 * dashboard.
 */
@Module({
  imports: [
    PrismaModule,
    LoggingModule,
    QueueModule,
    AuthModule,
    HealthModule,
    AppConfigModule,
    PlatformsModule,
    ProfilesModule,
    SourcesModule,
    SignalsModule,
    ConnectorsModule,
    NotificationsModule,
    SchedulerModule,
    AnalysisModule,
    IdeasModule,
    LlmModule,
    EmbeddingsModule,
  ],
  providers: [JsonLogger],
  exports: [JsonLogger],
})
export class AppModule {}
