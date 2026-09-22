import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthPayload } from '../auth/auth.types';
import { AccessScope } from '../auth/access-scope.service';
import { DraftContentSchema, type DraftContent } from './drafts.prompt';
import { DraftsService } from './drafts.service';

/**
 * Borradores. Se piden **a demanda**: la generación nunca la dispara el pipeline, que
 * es la regla del proyecto (el coach sugiere y el humano decide).
 */
@ApiTags('drafts')
@ApiBearerAuth()
@Controller()
export class DraftsController {
  constructor(
    private readonly drafts: DraftsService,
    private readonly access: AccessScope,
  ) {}

  @Post('ideas/:id/draft')
  @HttpCode(202)
  @ApiOperation({ summary: 'Pedir un borrador para la idea (encolado; cada pedido es una versión nueva)' })
  async request(
    @CurrentUser() user: AuthPayload,
    @Param('id') ideaId: string,
  ): Promise<{ queued: true }> {
    await this.access.assertIdea(user, ideaId);
    await this.drafts.requestGeneration(ideaId);
    return { queued: true };
  }

  @Get('drafts/:id')
  @ApiOperation({ summary: 'Ver un borrador' })
  get(@CurrentUser() user: AuthPayload, @Param('id') id: string) {
    return this.drafts.get(user, id);
  }

  @Patch('drafts/:id')
  @ApiOperation({ summary: 'Editar el borrador (queda marcado: una regeneración no lo pisa)' })
  update(
    @CurrentUser() user: AuthPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(DraftContentSchema)) content: DraftContent,
  ) {
    return this.drafts.update(user, id, content);
  }
}
