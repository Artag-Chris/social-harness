import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { env } from '../config/env';

/**
 * Cliente Prisma como servicio Nest.
 *
 * Se le pasa explícitamente `env.databaseUrl` (en vez de dejar que Prisma lea
 * `DATABASE_URL` del entorno) porque la URL puede haberse DERIVADO de
 * `DATABASE_HOST`/`POSTGRES_*`: así la resolución es una sola y vale tanto en
 * docker como corriendo el api fuera de docker.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ datasources: { db: { url: env.databaseUrl } } });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
