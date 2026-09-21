import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthPayload } from '../auth/auth.types';
import { ProfilesService } from './profiles.service';
import {
  AccountInputSchema,
  UpdateAccountSchema,
  type AccountInput,
  type UpdateAccountInput,
} from './profiles.schema';

/**
 * Cuentas de un perfil: **así se agrega y se quita una red**.
 *
 * La red se valida contra el catálogo (`GET /platforms`), así que sumar una red
 * nueva al proyecto no requiere tocar este archivo ni migrar nada.
 */
@ApiTags('profiles')
@ApiBearerAuth()
@Controller('profiles/:profileId/accounts')
export class AccountsController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get()
  @ApiOperation({ summary: 'Cuentas del perfil (una por red agregada)' })
  list(@CurrentUser() user: AuthPayload, @Param('profileId') profileId: string) {
    return this.profiles.listAccounts(user, profileId);
  }

  @Post()
  @ApiOperation({ summary: 'Agregar una cuenta/red al perfil' })
  create(
    @CurrentUser() user: AuthPayload,
    @Param('profileId') profileId: string,
    @Body(new ZodValidationPipe(AccountInputSchema)) input: AccountInput,
  ) {
    return this.profiles.addAccount(user, profileId, input);
  }

  @Patch(':accountId')
  @ApiOperation({ summary: 'Editar una cuenta' })
  update(
    @CurrentUser() user: AuthPayload,
    @Param('profileId') profileId: string,
    @Param('accountId') accountId: string,
    @Body(new ZodValidationPipe(UpdateAccountSchema)) input: UpdateAccountInput,
  ) {
    return this.profiles.updateAccount(user, profileId, accountId, input);
  }

  @Delete(':accountId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Quitarle una red al perfil' })
  async remove(
    @CurrentUser() user: AuthPayload,
    @Param('profileId') profileId: string,
    @Param('accountId') accountId: string,
  ): Promise<void> {
    await this.profiles.removeAccount(user, profileId, accountId);
  }
}
