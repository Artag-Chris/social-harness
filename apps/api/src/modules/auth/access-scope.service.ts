import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthPayload } from './auth.types';

/**
 * Alcance de datos: un solo lugar decide QUÉ puede ver y tocar cada usuario.
 *
 * Por qué centralizado: si cada servicio arma su filtro, tarde o temprano uno se
 * olvida y un usuario ve (o edita) datos de otro. Acá hay una función y se
 * reutiliza por relación (`match`, `idea`, `métrica` cuelgan del perfil).
 *
 * Regla de oro: **el dueño se sella con el `sub` del token**, nunca con algo que
 * venga del body.
 *
 * Caso `ownerId = null`: es el perfil que deja el seed para no arrancar vacío
 * (no tiene dueño porque en el seed no existe todavía un usuario). Se trata como
 * compartido para que se pueda ver y editar; en cuanto se crea un perfil desde la
 * API ya nace con dueño y queda estrictamente aislado. Es transitorio y está
 * escrito acá para que no se convierta en un misterio.
 */
@Injectable()
export class AccessScope {
  constructor(private readonly prisma: PrismaService) {}

  /** `SUPER_ADMIN` (de atiende) ve todo; el resto, solo lo suyo. */
  isGlobal(user: AuthPayload): boolean {
    return user.role === 'SUPER_ADMIN';
  }

  /** Filtro Prisma reutilizable por relación para todo lo que cuelga del perfil. */
  profileWhere(user: AuthPayload): Prisma.ProfileWhereInput {
    if (this.isGlobal(user)) return {};
    return { OR: [{ ownerId: user.sub }, { ownerId: null }] };
  }

  /** Campos de propiedad que se escriben al crear. */
  ownership(user: AuthPayload): { ownerId: string; businessId: string | null } {
    return { ownerId: user.sub, businessId: user.businessId ?? null };
  }

  /**
   * Valida que el perfil exista Y sea alcanzable por el usuario.
   * Devuelve 404 (no 403) a propósito: no se le confirma a un usuario que el id
   * de otro existe.
   */
  async assertProfile(user: AuthPayload, profileId: string): Promise<void> {
    const found = await this.prisma.profile.findFirst({
      where: { id: profileId, ...this.profileWhere(user) },
      select: { id: true },
    });

    if (!found) {
      throw new NotFoundException(`El perfil ${profileId} no existe.`);
    }
  }

  /** Ídem para una idea (cuelga del perfil). Se usa antes de encolar un trabajo. */
  async assertIdea(user: AuthPayload, ideaId: string): Promise<void> {
    const found = await this.prisma.contentIdea.findFirst({
      where: { id: ideaId, profile: this.profileWhere(user) },
      select: { id: true },
    });

    if (!found) {
      throw new NotFoundException(`La idea ${ideaId} no existe.`);
    }
  }
}
