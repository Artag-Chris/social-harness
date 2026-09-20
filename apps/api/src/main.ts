import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { JsonLogger } from './common/json-logger.service';
import { enabledConnectors, features } from './config/features';
import { env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const logger = app.get(JsonLogger);
  app.useLogger(logger);

  app.setGlobalPrefix('api');
  if (env.TRUST_PROXY > 0) app.set('trust proxy', env.TRUST_PROXY);

  /**
   * Sin esto, `docker compose down` (SIGTERM) mata el proceso sin que Nest corra
   * los `onModuleDestroy`: el pool de Prisma queda abierto y, desde la fase 2,
   * los workers de BullMQ dejarían jobs a medias hasta que expiren. Es
   * barato y evita un cierre sucio en cada deploy.
   */
  app.enableShutdownHooks();

  // El dashboard corre en otro origen (Vercel/3001) y llama directo al harness
  // con el Bearer de atiende: CORS por configuración, con `*` por defecto en dev.
  const corsOrigins = env.corsAllowedOrigins;
  const allowAnyOrigin = corsOrigins.includes('*');
  app.enableCors({
    origin: allowAnyOrigin ? true : corsOrigins,
    // Con `*` no se pueden mandar credenciales; acá la auth es un Bearer
    // explícito, no una cookie, así que no hace falta que lo sean.
    credentials: !allowAnyOrigin,
  });
  if (allowAnyOrigin && env.NODE_ENV === 'production') {
    logger.warn(
      {
        msg: 'CORS_ALLOWED_ORIGINS="*": cualquier origen puede llamar a la API.',
        fix: 'En el server poné el dominio del dashboard (ej. https://tu-dashboard.vercel.app).',
      },
      'Bootstrap',
    );
  }

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  const config = new DocumentBuilder()
    .setTitle('Social Harness API')
    .setDescription(
      'Señales de tendencia → relevancia por perfil → ideas, calendario y borradores. La IA nunca publica.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config), {
    jsonDocumentUrl: 'api/docs-json',
  });

  if (env.JWT_SECRET === 'dev-secret-change-me') {
    logger.warn(
      {
        msg: 'JWT_SECRET está en el valor por defecto: el dashboard de atiende dará 401 en la pestaña Social.',
        fix: 'Copiá el JWT_SECRET real de atiende en social-harness/.env y recreá el contenedor api.',
      },
      'Bootstrap',
    );
  }

  /**
   * Los proveedores de IA ya quedaron resueltos por el `LlmModule` (principal +
   * respaldo desde el `.env`); esto solo los deja ver en el log. Es la línea que
   * se mira cuando "no aparecen ideas": casi siempre es un `mock` silencioso.
   */
  const ai = {
    provider: features.llm.provider,
    fallback: features.llm.fallback,
    model: features.llm.model,
    embeddings: features.llm.embeddings,
    embeddingsModel: features.llm.embeddingsModel,
  };

  if (env.llmMode === 'mock' || env.embedMode === 'mock') {
    logger.warn(
      {
        msg: 'IA/embeddings en modo mock: el pipeline corre determinístico, sin llaves ni red.',
        ...ai,
        fix: 'Poné DEEPSEEK_API_KEY en el .env (y OPENAI_API_KEY para embeddings reales).',
      },
      'Bootstrap',
    );
  } else {
    logger.log({ msg: 'Proveedores de IA resueltos', ...ai }, 'Bootstrap');
  }

  await app.listen(env.PORT);
  logger.log(
    {
      msg: 'social-harness api escuchando',
      port: env.PORT,
      llm: `${features.llm.provider}/${features.llm.model}${features.llm.fallback ? ` (respaldo: ${features.llm.fallback})` : ''}`,
      embeddings: `${features.llm.embeddings}/${features.llm.embeddingsModel}`,
      // Se resuelven las features ACÁ (aunque todavía las consuma la fase 2):
      // así un `FEATURE_CONNECTORS` mal escrito falla en el boot en vez de
      // descubrirse recién cuando alguien importe `features`. Y de paso el log
      // dice qué quedó activo, que es la primera cosa que se pregunta al
      // depurar "por qué no trajo señales".
      connectors: enabledConnectors(features),
      docs: '/api/docs',
    },
    'Bootstrap',
  );
}

void bootstrap().catch((err: unknown) => {
  process.stderr.write(`FATAL: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
