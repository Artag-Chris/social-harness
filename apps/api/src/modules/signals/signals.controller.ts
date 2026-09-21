import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthPayload } from '../auth/auth.types';
import { SignalsService } from './signals.service';
import {
  ManualSignalSchema,
  SignalListQuerySchema,
  type ManualSignalInput,
  type SignalListQuery,
} from './signals.schema';
import { z } from 'zod';

/** Para `from-url` la URL es obligatoria (es el otro camino de entrada). */
const ManualUrlSchema = ManualSignalSchema.extend({
  url: z
    .string()
    .url()
    .refine((value) => /^https?:\/\//i.test(value), { message: 'La URL debe ser http(s).' }),
});

@ApiTags('signals')
@ApiBearerAuth()
@Controller('signals')
export class SignalsController {
  constructor(private readonly signals: SignalsService) {}

  @Get()
  @ApiOperation({ summary: 'Señales que le tocaron a mis perfiles (con filtros)' })
  list(
    @CurrentUser() user: AuthPayload,
    @Query(new ZodValidationPipe(SignalListQuerySchema)) query: SignalListQuery,
  ) {
    return this.signals.list(user, query);
  }

  @Post('from-text')
  @ApiOperation({ summary: 'Pegar una inspiración (texto y/o URL) para un perfil' })
  fromText(
    @CurrentUser() user: AuthPayload,
    @Body(new ZodValidationPipe(ManualSignalSchema)) input: ManualSignalInput,
  ) {
    return this.signals.createManual(user, input);
  }

  @Post('from-url')
  @ApiOperation({ summary: 'Pegar una URL (de lo que no se puede automatizar) para un perfil' })
  fromUrl(
    @CurrentUser() user: AuthPayload,
    @Body(new ZodValidationPipe(ManualUrlSchema)) input: ManualSignalInput,
  ) {
    return this.signals.createManual(user, input);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de una señal (incluye el original si es duplicada)' })
  get(@CurrentUser() user: AuthPayload, @Param('id') id: string) {
    return this.signals.get(user, id);
  }
}
