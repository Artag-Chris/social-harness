import { Module } from '@nestjs/common';
import { AppConfigController } from './app-config.controller';

/** Configuración efectiva para la UI (`GET /config`). Solo lee flags, sin estado. */
@Module({
  controllers: [AppConfigController],
})
export class AppConfigModule {}
