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
  ObjectiveInputSchema,
  UpdateObjectiveSchema,
  type ObjectiveInput,
  type UpdateObjectiveInput,
} from './profiles.schema';

/**
 * Objetivos del perfil: es lo que convierte "publicá cosas" en "publicá para
 * lograr X". El análisis de relevancia y las ideas se priorizan contra esto.
 */
@ApiTags('profiles')
@ApiBearerAuth()
@Controller('profiles/:profileId/objectives')
export class ObjectivesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get()
  @ApiOperation({ summary: 'Objetivos del perfil' })
  list(@CurrentUser() user: AuthPayload, @Param('profileId') profileId: string) {
    return this.profiles.listObjectives(user, profileId);
  }

  @Post()
  @ApiOperation({ summary: 'Agregar un objetivo (métrica, meta y fecha)' })
  create(
    @CurrentUser() user: AuthPayload,
    @Param('profileId') profileId: string,
    @Body(new ZodValidationPipe(ObjectiveInputSchema)) input: ObjectiveInput,
  ) {
    return this.profiles.addObjective(user, profileId, input);
  }

  @Patch(':objectiveId')
  @ApiOperation({ summary: 'Editar un objetivo (incluye marcar avance o estado)' })
  update(
    @CurrentUser() user: AuthPayload,
    @Param('profileId') profileId: string,
    @Param('objectiveId') objectiveId: string,
    @Body(new ZodValidationPipe(UpdateObjectiveSchema)) input: UpdateObjectiveInput,
  ) {
    return this.profiles.updateObjective(user, profileId, objectiveId, input);
  }

  @Delete(':objectiveId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Borrar un objetivo' })
  async remove(
    @CurrentUser() user: AuthPayload,
    @Param('profileId') profileId: string,
    @Param('objectiveId') objectiveId: string,
  ): Promise<void> {
    await this.profiles.removeObjective(user, profileId, objectiveId);
  }
}
