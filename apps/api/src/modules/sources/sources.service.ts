import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { summarizeZodIssues } from '../../common/zod-issues';
import { PrismaService } from '../../prisma/prisma.service';
import { parseParams, type SourceInput, type SourceUpdateInput } from './sources.schema';

/**
 * Catálogo de fuentes de tendencia.
 *
 * Es **compartido** (decisión del ADR-001/002): la misma URL no se guarda una vez
 * por perfil. Cada perfil la *selecciona* (N:M) con su propia cadencia. Por eso
 * acá no hay filtro por dueño: el catálogo es de la instalación, y lo que es de
 * cada uno es la selección (`ProfileSource`), que se administra en `/profiles`.
 *
 * Ningún secreto vive acá: las llaves van en el `.env` y la fuente, si necesita
 * una, referencia la variable por nombre (`authEnv`).
 */
@Injectable()
export class SourcesService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    return this.prisma.source.findMany({
      include: {
        // En qué perfiles está seleccionada (para que la UI muestre "usada por N").
        selections: { select: { profileId: true, enabled: true, intervalHours: true } },
      },
      orderBy: [{ enabled: 'desc' }, { name: 'asc' }],
    });
  }

  async get(sourceId: string) {
    const source = await this.prisma.source.findUnique({
      where: { id: sourceId },
      include: { selections: { select: { profileId: true, enabled: true, intervalHours: true } } },
    });

    if (!source) throw new NotFoundException(`La fuente ${sourceId} no existe.`);
    return source;
  }

  async create(input: SourceInput) {
    return this.prisma.source.create({
      data: {
        name: input.name,
        kind: input.kind,
        // Los params ya vienen validados por tipo (unión discriminada del pipe).
        params: input.params as Prisma.InputJsonValue,
        limits: input.limits as Prisma.InputJsonValue,
        enabled: input.enabled,
        intervalHours: input.intervalHours,
        // Dueña de la próxima pasada del ciclo.
        nextRunAt: new Date(),
      },
      include: { selections: { select: { profileId: true, enabled: true, intervalHours: true } } },
    });
  }

  /** El `kind` no se cambia: si vienen `params`, se validan contra el tipo actual. */
  async update(sourceId: string, input: SourceUpdateInput) {
    const source = await this.get(sourceId);

    const params =
      input.params === undefined ? undefined : this.validateParams(source.kind, input.params);

    return this.prisma.source.update({
      where: { id: sourceId },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        ...(input.intervalHours === undefined ? {} : { intervalHours: input.intervalHours }),
        ...(input.limits === undefined ? {} : { limits: input.limits as Prisma.InputJsonValue }),
        ...(params === undefined ? {} : { params: params as Prisma.InputJsonValue }),
      },
      include: { selections: { select: { profileId: true, enabled: true, intervalHours: true } } },
    });
  }

  /** Borra la fuente y, en cascada, las selecciones que la usaban. */
  async remove(sourceId: string): Promise<void> {
    await this.get(sourceId);
    await this.prisma.source.delete({ where: { id: sourceId } });
  }

  private validateParams(kind: string, params: unknown): unknown {
    try {
      return parseParams(kind as never, params);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new BadRequestException({
          message: `Los parámetros no corresponden al tipo ${kind}`,
          issues: summarizeZodIssues(error),
        });
      }
      throw error;
    }
  }
}
