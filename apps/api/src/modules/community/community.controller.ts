import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AccessScope } from '../auth/access-scope.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthPayload } from '../auth/auth.types';
import {
  SegmentInputSchema,
  SegmentListQuerySchema,
  SegmentPatchSchema,
  type SegmentInput,
  type SegmentListQuery,
  type SegmentPatch,
} from './community.schema';
import { CommunityService } from './community.service';

/**
 * Audiencia del perfil.
 *
 * Es el objeto compartido entre los dos coaches: acá se crea y se corrige, y el coach de
 * contenido lo consume para escribir ideas y borradores.
 */
@ApiTags('community')
@ApiBearerAuth()
@Controller('profiles/:profileId/audience')
export class CommunityController {
  constructor(
    private readonly community: CommunityService,
    private readonly access: AccessScope,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Segmentos de audiencia del perfil (sin los archivados)' })
  list(
    @CurrentUser() user: AuthPayload,
    @Param('profileId') profileId: string,
    @Query(new ZodValidationPipe(SegmentListQuerySchema)) query: SegmentListQuery,
  ) {
    return this.community.listSegments(user, profileId, query);
  }

  @Post()
  @ApiOperation({ summary: 'Crear o corregir un segmento a mano (queda como tuyo)' })
  create(
    @CurrentUser() user: AuthPayload,
    @Param('profileId') profileId: string,
    @Body(new ZodValidationPipe(SegmentInputSchema)) input: SegmentInput,
  ) {
    return this.community.createSegment(user, profileId, input);
  }

  @Post('propose')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Proponer segmentos con IA (encolado). Sin nicho ni audiencia declarada no gasta IA',
  })
  async propose(
    @CurrentUser() user: AuthPayload,
    @Param('profileId') profileId: string,
  ): Promise<{ queued: true }> {
    await this.access.assertProfile(user, profileId);
    await this.community.requestPropose(profileId);
    return { queued: true };
  }

  @Patch(':segmentId')
  @ApiOperation({ summary: 'Editar o archivar un segmento (lo que toques queda como tuyo)' })
  patch(
    @CurrentUser() user: AuthPayload,
    @Param('profileId') profileId: string,
    @Param('segmentId') segmentId: string,
    @Body(new ZodValidationPipe(SegmentPatchSchema)) patch: SegmentPatch,
  ) {
    return this.community.patchSegment(user, profileId, segmentId, patch);
  }
}
