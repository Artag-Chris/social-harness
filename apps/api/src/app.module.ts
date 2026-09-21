import { Module } from '@nestjs/common';
import { JsonLogger } from './common/json-logger.service';
import { AppConfigModule } from './modules/app-config/app-config.module';
import { AuthModule } from './modules/auth/auth.module';
import { EmbeddingsModule } from './modules/embeddings/embeddings.module';
import { HealthModule } from './modules/health/health.module';
import { LlmModule } from './modules/llm/llm.module';
import { PlatformsModule } from './modules/platforms/platforms.module';
import { ProfilesModule } from './modules/profiles/profiles.module';
import { SourcesModule } from './modules/sources/sources.module';
import { PrismaModule } from './prisma/prisma.module';

/**
 * Módulo raíz.
 *
 * Implementado: base de datos, health, auth (JWT de atiende con guard global),
 * catálogo de redes, config para la UI, perfiles/cuentas/objetivos y el catálogo
 * de fuentes con su verificación. Falta del plan: conectores + recolección,
 * análisis, ideas, borradores, métricas y la pestaña del dashboard.
 */
@Module({
  imports: [
    PrismaModule,
    AuthModule,
    HealthModule,
    AppConfigModule,
    PlatformsModule,
    ProfilesModule,
    SourcesModule,
    LlmModule,
    EmbeddingsModule,
  ],
  providers: [JsonLogger],
  exports: [JsonLogger],
})
export class AppModule {}
