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
import { ProbeService } from './probe/probe.service';
import {
  ProbeInputSchema,
  SourceInputSchema,
  SourceUpdateSchema,
  type ProbeInput,
  type SourceInput,
  type SourceUpdateInput,
} from './sources.schema';
import { SourcesService } from './sources.service';
import { sourceTemplates } from './sources.templates';

@ApiTags('sources')
@ApiBearerAuth()
@Controller('sources')
export class SourcesController {
  constructor(
    private readonly sources: SourcesService,
    private readonly probe: ProbeService,
  ) {}

  // Ojo con el orden: `templates` y `probe` van ANTES de `:id`, si no Nest los
  // interpreta como un id.
  @Get('templates')
  @ApiOperation({ summary: 'Plantillas de fuente por tipo (punto de partida para el dashboard)' })
  templates() {
    return { templates: sourceTemplates() };
  }

  @Post('probe')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Verificar una fuente antes de guardarla (no guarda nada; devuelve previsualización)',
  })
  probeSource(@Body(new ZodValidationPipe(ProbeInputSchema)) input: ProbeInput) {
    return this.probe.probe(input);
  }

  @Get()
  @ApiOperation({ summary: 'Catálogo de fuentes (compartido) y en qué perfiles está usada' })
  list() {
    return this.sources.list();
  }

  @Post()
  @ApiOperation({ summary: 'Guardar una fuente en el catálogo' })
  create(@Body(new ZodValidationPipe(SourceInputSchema)) input: SourceInput) {
    return this.sources.create(input);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de una fuente' })
  get(@Param('id') id: string) {
    return this.sources.get(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Editar nombre, límites, cadencia, estado o params' })
  update(@Param('id') id: string, @Body(new ZodValidationPipe(SourceUpdateSchema)) input: SourceUpdateInput) {
    return this.sources.update(id, input);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Borrar una fuente del catálogo (arrastra las selecciones)' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.sources.remove(id);
  }
}
