import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AccessScope } from '../auth/access-scope.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthPayload } from '../auth/auth.types';
import {
  ProposeTargetsQuerySchema,
  TargetInputSchema,
  TargetListQuerySchema,
  TargetPatchSchema,
  type ProposeTargetsQuery,
  type TargetInput,
  type TargetListQuery,
  type TargetPatch,
} from './community.schema';
import { CommunityService } from './community.service';

/**
 * Comunidades donde participar.
 *
 * Va en su propio controlador porque la ruta es de comunidades, no de audiencia (misma
 * división que métricas/crecimiento). Todo lo propuesto nace `PROPOSED` y sin verificar: acá
 * es donde el humano acepta, descarta o confirma que el lugar existe.
 */
@ApiTags('community')
@ApiBearerAuth()
@Controller('profiles/:profileId/communities')
export class CommunityTargetsController {
  constructor(
    private readonly community: CommunityService,
    private readonly access: AccessScope,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Comunidades del perfil (todas, o filtradas por estado)' })
  list(
    @CurrentUser() user: AuthPayload,
    @Param('profileId') profileId: string,
    @Query(new ZodValidationPipe(TargetListQuerySchema)) query: TargetListQuery,
  ) {
    return this.community.listTargets(user, profileId, query);
  }

  @Post()
  @ApiOperation({ summary: 'Agregar una comunidad a mano (nace aceptada y verificada)' })
  create(
    @CurrentUser() user: AuthPayload,
    @Param('profileId') profileId: string,
    @Body(new ZodValidationPipe(TargetInputSchema)) input: TargetInput,
  ) {
    return this.community.createTarget(user, profileId, input);
  }

  @Post('propose')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Proponer comunidades con IA (encolado). Sin audiencia cargada no gasta IA',
  })
  async propose(
    @CurrentUser() user: AuthPayload,
    @Param('profileId') profileId: string,
    @Query(new ZodValidationPipe(ProposeTargetsQuerySchema)) query: ProposeTargetsQuery,
  ): Promise<{ queued: true }> {
    await this.access.assertProfile(user, profileId);
    await this.community.requestProposeTargets(profileId, query.segmentId);
    return { queued: true };
  }

  @Patch(':targetId')
  @ApiOperation({ summary: 'Aceptar, descartar, marcar como unido, verificar o corregir' })
  patch(
    @CurrentUser() user: AuthPayload,
    @Param('profileId') profileId: string,
    @Param('targetId') targetId: string,
    @Body(new ZodValidationPipe(TargetPatchSchema)) patch: TargetPatch,
  ) {
    return this.community.patchTarget(user, profileId, targetId, patch);
  }
}
