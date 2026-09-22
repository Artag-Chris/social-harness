import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AccessScope } from '../auth/access-scope.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthPayload } from '../auth/auth.types';
import { IdeasService } from './ideas.service';
import {
  IdeaInputSchema,
  IdeaListQuerySchema,
  IdeaUpdateSchema,
  type IdeaInput,
  type IdeaListQuery,
  type IdeaUpdateInput,
} from './ideas.schema';

@ApiTags('ideas')
@ApiBearerAuth()
@Controller('ideas')
export class IdeasController {
  constructor(private readonly ideas: IdeasService) {}

  @Get()
  @ApiOperation({ summary: 'Calendario: ideas con filtros por perfil, estado, red y fechas' })
  list(
    @CurrentUser() user: AuthPayload,
    @Query(new ZodValidationPipe(IdeaListQuerySchema)) query: IdeaListQuery,
  ) {
    return this.ideas.list(user, query);
  }

  @Post()
  @ApiOperation({ summary: 'Cargar una idea a mano' })
  create(
    @CurrentUser() user: AuthPayload,
    @Body(new ZodValidationPipe(IdeaInputSchema)) input: IdeaInput,
  ) {
    return this.ideas.create(user, input);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de una idea (con las señales que la sostienen)' })
  get(@CurrentUser() user: AuthPayload, @Param('id') id: string) {
    return this.ideas.get(user, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Mover en el calendario, aprobar, descartar o marcar como publicada' })
  update(
    @CurrentUser() user: AuthPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(IdeaUpdateSchema)) input: IdeaUpdateInput,
  ) {
    return this.ideas.update(user, id, input);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Borrar una idea' })
  async remove(@CurrentUser() user: AuthPayload, @Param('id') id: string): Promise<void> {
    await this.ideas.remove(user, id);
  }
}

/**
 * "Generar ideas ahora" para un perfil.
 *
 * Existe porque el gasto de IA se dispara a mano: con `AUTO_IDEAS_ENABLED=false` este
 * es el único camino, y con la automática prendida sirve para no esperar el ciclo.
 */
@ApiTags('profiles')
@ApiBearerAuth()
@Controller('profiles/:profileId/ideas')
export class ProfileIdeasController {
  constructor(
    private readonly ideas: IdeasService,
    private readonly access: AccessScope,
  ) {}

  @Post()
  @HttpCode(202)
  @ApiOperation({ summary: 'Generar ideas a partir de las señales relevantes (encolado)' })
  async generate(
    @CurrentUser() user: AuthPayload,
    @Param('profileId') profileId: string,
  ): Promise<{ queued: true }> {
    await this.access.assertProfile(user, profileId);
    await this.ideas.requestGeneration(profileId);
    return { queued: true };
  }
}
