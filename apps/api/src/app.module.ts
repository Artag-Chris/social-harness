import { Module } from '@nestjs/common';
import { JsonLogger } from './common/json-logger.service';
import { LoggingModule } from './common/logging.module';
import { AnalysisModule } from './modules/analysis/analysis.module';
import { AppConfigModule } from './modules/app-config/app-config.module';
import { AuthModule } from './modules/auth/auth.module';
import { ConnectorsModule } from './modules/connectors/connectors.module';
import { DraftsModule } from './modules/drafts/drafts.module';
import { EmbeddingsModule } from './modules/embeddings/embeddings.module';
import { HealthModule } from './modules/health/health.module';
import { IdeasModule } from './modules/ideas/ideas.module';
import { LlmModule } from './modules/llm/llm.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PerformanceModule } from './modules/performance/performance.module';
import { PlatformsModule } from './modules/platforms/platforms.module';
import { ProfilesModule } from './modules/profiles/profiles.module';
import { QueueModule } from './modules/queue/queue.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';
import { SignalsModule } from './modules/signals/signals.module';
import { SourcesModule } from './modules/sources/sources.module';
import { UsageModule } from './modules/usage/usage.module';
import { PrismaModule } from './prisma/prisma.module';

/**
 * Módulo raíz.
 *
 * Implementado: base de datos, auth (JWT de atiende), catálogos de redes y fuentes,
 * perfiles con cuentas y objetivos, conectores que recolectan, scheduler con BullMQ,
 * ingestión con dedup, señales (lectura + pegado manual), análisis de relevancia,
 * ideas con calendario, borradores **a demanda**, métricas de las cuentas, reporte de
 * rendimiento, control de gasto de IA y la bandeja de avisos.
 * Falta del plan: la pestaña del dashboard (fase 5) y los conectores oficiales de
 * métricas (ADR-002), que hoy se cargan a mano.
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
    DraftsModule,
    MetricsModule,
    PerformanceModule,
    UsageModule,
    LlmModule,
    EmbeddingsModule,
  ],
  providers: [JsonLogger],
  exports: [JsonLogger],
})
export class AppModule {}
