import { Module } from '@nestjs/common';
import { AccountsController } from './accounts.controller';
import { ObjectivesController } from './objectives.controller';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';

/**
 * Perfiles, cuentas y objetivos. `AccessScope` llega desde el `AuthModule`
 * global, así que acá no hay que importarlo.
 */
@Module({
  controllers: [ProfilesController, AccountsController, ObjectivesController],
  providers: [ProfilesService],
  exports: [ProfilesService],
})
export class ProfilesModule {}
