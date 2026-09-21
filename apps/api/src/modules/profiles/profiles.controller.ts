import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthPayload } from '../auth/auth.types';
import { ProfilesService } from './profiles.service';
import {
  CreateProfileSchema,
  ProfileSourcesSchema,
  ScheduleSchema,
  SourceSelectionSchema,
  UpdateProfileSchema,
  type CreateProfileInput,
  type SourceSelectionInput,
  type UpdateProfileInput,
} from './profiles.schema';

@ApiTags('profiles')
@ApiBearerAuth()
@Controller('profiles')
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get()
  @ApiOperation({ summary: 'Perfiles del usuario (con cuentas, objetivos y fuentes)' })
  list(@CurrentUser() user: AuthPayload) {
    return this.profiles.list(user);
  }

  @Post()
  @ApiOperation({ summary: 'Crear perfil (queda a nombre del usuario del token)' })
  create(
    @CurrentUser() user: AuthPayload,
    @Body(new ZodValidationPipe(CreateProfileSchema)) input: CreateProfileInput,
  ) {
    return this.profiles.create(user, input);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de un perfil' })
  get(@CurrentUser() user: AuthPayload, @Param('id') id: string) {
    return this.profiles.get(user, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Editar un perfil' })
  update(
    @CurrentUser() user: AuthPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateProfileSchema)) input: UpdateProfileInput,
  ) {
    return this.profiles.update(user, id, input);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Borrar un perfil (arrastra cuentas, objetivos, ideas y selecciones)' })
  async remove(@CurrentUser() user: AuthPayload, @Param('id') id: string): Promise<void> {
    await this.profiles.remove(user, id);
  }

  @Patch(':id/schedule')
  @ApiOperation({ summary: 'Cadencia de recolección en horas (null = solo a mano)' })
  schedule(
    @CurrentUser() user: AuthPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ScheduleSchema)) input: { scheduleHours: number | null },
  ) {
    return this.profiles.setSchedule(user, id, input.scheduleHours);
  }

  @Put(':id/sources')
  @ApiOperation({ summary: 'Reemplazar las fuentes seleccionadas por el perfil (N:M)' })
  setSources(
    @CurrentUser() user: AuthPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ProfileSourcesSchema)) input: { sourceIds: string[] },
  ) {
    return this.profiles.setSources(user, id, input.sourceIds);
  }

  @Patch(':id/sources/:sourceId')
  @ApiOperation({ summary: 'Activar/desactivar una fuente del perfil o darle cadencia propia' })
  updateSource(
    @CurrentUser() user: AuthPayload,
    @Param('id') id: string,
    @Param('sourceId') sourceId: string,
    @Body(new ZodValidationPipe(SourceSelectionSchema)) input: SourceSelectionInput,
  ) {
    return this.profiles.updateSourceSelection(user, id, sourceId, input);
  }

  @Delete(':id/sources/:sourceId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Quitarle una fuente al perfil (no borra la fuente del catálogo)' })
  async removeSource(
    @CurrentUser() user: AuthPayload,
    @Param('id') id: string,
    @Param('sourceId') sourceId: string,
  ): Promise<void> {
    await this.profiles.removeSourceSelection(user, id, sourceId);
  }
}
