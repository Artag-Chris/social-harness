import { Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessScope } from '../auth/access-scope.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthPayload } from '../auth/auth.types';
import { DispatchService } from './dispatch.service';

/**
 * "Buscar ahora" de un perfil: dispara SUS fuentes sin esperar la cadencia.
 *
 * Responde 202 (Accepted) y no 200: el trabajo real lo hacen los workers, así que
 * lo único que se confirma es que quedó encolado. El resultado aparece en las
 * señales (y en la corrida de cada fuente).
 */
@ApiTags('profiles')
@ApiBearerAuth()
@Controller('profiles/:profileId/run')
export class ProfileRunController {
  constructor(
    private readonly dispatch: DispatchService,
    private readonly access: AccessScope,
  ) {}

  @Post()
  @HttpCode(202)
  @ApiOperation({ summary: 'Buscar ahora: recolecta las fuentes de este perfil' })
  async run(
    @CurrentUser() user: AuthPayload,
    @Param('profileId') profileId: string,
  ) {
    await this.access.assertProfile(user, profileId);
    return this.dispatch.dispatchProfile(profileId);
  }
}
