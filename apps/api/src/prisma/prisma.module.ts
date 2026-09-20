import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** Global: casi todos los módulos necesitan la base y no vale la pena importarlo en cada uno. */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
