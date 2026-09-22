import { Module } from '@nestjs/common';
import { UsageController } from './usage.controller';

/** Control de gasto de IA (lee `CoachRun`, que llena cada llamada del pipeline). */
@Module({ controllers: [UsageController] })
export class UsageModule {}
