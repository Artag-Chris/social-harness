import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessScope } from '../auth/access-scope.service';
import type { AuthPayload } from '../auth/auth.types';
import type {
  AccountInput,
  CreateProfileInput,
  ObjectiveInput,
  SourceSelectionInput,
  UpdateAccountInput,
  UpdateObjectiveInput,
  UpdateProfileInput,
} from './profiles.schema';

/**
 * Perfiles y todo lo que cuelga de ellos (cuentas, objetivos, selección de
 * fuentes).
 *
 * Reglas que se aplican en TODOS los métodos:
 *  - el alcance del usuario se resuelve con `AccessScope` (nunca con un id del body);
 *  - el dueño se sella al crear, con el `sub` del token;
 *  - si el perfil no existe o no es alcanzable, es 404 (no 403).
 */

/** Relaciones que devuelve el detalle de un perfil. */
const PROFILE_INCLUDE = {
  accounts: { orderBy: { platform: 'asc' } },
  objectives: { orderBy: { createdAt: 'asc' } },
  sources: { include: { source: true }, orderBy: { createdAt: 'asc' } },
  _count: { select: { ideas: true, profileSignals: true } },
} satisfies Prisma.ProfileInclude;

@Injectable()
export class ProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessScope,
  ) {}

  /**
   * Rearma la próxima corrida: "en la próxima pasada del ciclo".
   *
   * Se usa al crear el perfil, al cambiarle la cadencia y al cambiarle las
   * fuentes: después de configurar algo uno quiere ver resultados pronto, no
   * dentro de 24 h. Si no hay cadencia (`scheduleHours = null`), queda en null y
   * el perfil solo se corre a mano.
   *
   * Después de cada recolección, el scheduler de la fase 2 reprograma
   * `nextRunAt = now + cadencia`.
   */
  private rearmNextRun(scheduleHours: number | null | undefined): Date | null {
    return scheduleHours ? new Date() : null;
  }

  async list(user: AuthPayload) {
    return this.prisma.profile.findMany({
      where: this.access.profileWhere(user),
      include: PROFILE_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
  }

  async get(user: AuthPayload, profileId: string) {
    await this.access.assertProfile(user, profileId);

    return this.prisma.profile.findFirstOrThrow({
      where: { id: profileId, ...this.access.profileWhere(user) },
      include: PROFILE_INCLUDE,
    });
  }

  async create(user: AuthPayload, input: CreateProfileInput) {
    return this.prisma.profile.create({
      data: {
        ...input,
        // El dueño SIEMPRE sale del token.
        ...this.access.ownership(user),
        nextRunAt: this.rearmNextRun(input.scheduleHours),
      },
      include: PROFILE_INCLUDE,
    });
  }

  async update(user: AuthPayload, profileId: string, input: UpdateProfileInput) {
    await this.access.assertProfile(user, profileId);

    const scheduleChanged = Object.prototype.hasOwnProperty.call(input, 'scheduleHours');

    return this.prisma.profile.update({
      where: { id: profileId },
      data: {
        ...input,
        // Solo se recalcula la próxima corrida si la cadencia cambió.
        ...(scheduleChanged ? { nextRunAt: this.rearmNextRun(input.scheduleHours) } : {}),
      },
      include: PROFILE_INCLUDE,
    });
  }

  async remove(user: AuthPayload, profileId: string): Promise<void> {
    await this.access.assertProfile(user, profileId);
    // Las cuentas, objetivos, ideas y selecciones se van en cascada (schema).
    await this.prisma.profile.delete({ where: { id: profileId } });
  }

  /** Cadencia desde el dashboard (valores gruesos: 1h, 3h, 6h, 12h, 24h, 72h…). */
  async setSchedule(user: AuthPayload, profileId: string, scheduleHours: number | null) {
    return this.update(user, profileId, { scheduleHours });
  }

  // ── Cuentas: agregar o quitar una RED a un perfil es esto ──────────────────

  async listAccounts(user: AuthPayload, profileId: string) {
    await this.access.assertProfile(user, profileId);

    return this.prisma.socialAccount.findMany({
      where: { profileId },
      orderBy: [{ platform: 'asc' }, { handle: 'asc' }],
    });
  }

  async listObjectives(user: AuthPayload, profileId: string) {
    await this.access.assertProfile(user, profileId);

    return this.prisma.objective.findMany({ where: { profileId }, orderBy: { createdAt: 'asc' } });
  }

  async addAccount(user: AuthPayload, profileId: string, input: AccountInput) {
    await this.access.assertProfile(user, profileId);

    try {
      return await this.prisma.socialAccount.create({ data: { ...input, profileId } });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          `El perfil ya tiene la cuenta ${input.handle} en ${input.platform}.`,
        );
      }
      throw error;
    }
  }

  async updateAccount(
    user: AuthPayload,
    profileId: string,
    accountId: string,
    input: UpdateAccountInput,
  ) {
    await this.access.assertProfile(user, profileId);
    await this.assertAccount(profileId, accountId);

    return this.prisma.socialAccount.update({ where: { id: accountId }, data: input });
  }

  async removeAccount(user: AuthPayload, profileId: string, accountId: string): Promise<void> {
    await this.access.assertProfile(user, profileId);
    await this.assertAccount(profileId, accountId);
    await this.prisma.socialAccount.delete({ where: { id: accountId } });
  }

  // ── Objetivos ─────────────────────────────────────────────────────────────

  async addObjective(user: AuthPayload, profileId: string, input: ObjectiveInput) {
    await this.access.assertProfile(user, profileId);

    return this.prisma.objective.create({ data: { ...input, profileId } });
  }

  async updateObjective(
    user: AuthPayload,
    profileId: string,
    objectiveId: string,
    input: UpdateObjectiveInput,
  ) {
    await this.access.assertProfile(user, profileId);
    await this.assertObjective(profileId, objectiveId);

    return this.prisma.objective.update({ where: { id: objectiveId }, data: input });
  }

  async removeObjective(user: AuthPayload, profileId: string, objectiveId: string): Promise<void> {
    await this.access.assertProfile(user, profileId);
    await this.assertObjective(profileId, objectiveId);
    await this.prisma.objective.delete({ where: { id: objectiveId } });
  }

  // ── Selección de fuentes (N:M, con cadencia propia) ───────────────────────

  /** Reemplaza la selección del perfil por la lista recibida. */
  async setSources(user: AuthPayload, profileId: string, sourceIds: string[]) {
    await this.access.assertProfile(user, profileId);

    const unique = [...new Set(sourceIds)];
    if (unique.length > 0) {
      const found = await this.prisma.source.findMany({
        where: { id: { in: unique } },
        select: { id: true },
      });
      const missing = unique.filter((id) => !found.some((source) => source.id === id));
      if (missing.length > 0) {
        throw new NotFoundException(`No existen estas fuentes: ${missing.join(', ')}.`);
      }
    }

    await this.prisma.$transaction([
      // Se quitan solo las que ya no están (no se toca `enabled` ni la cadencia
      // de las que siguen seleccionadas: si el usuario las ajustó, se respeta).
      this.prisma.profileSource.deleteMany({
        where: { profileId, sourceId: { notIn: unique.length > 0 ? unique : ['__ninguna__'] } },
      }),
      ...unique.map((sourceId) =>
        this.prisma.profileSource.upsert({
          where: { profileId_sourceId: { profileId, sourceId } },
          update: {},
          create: { profileId, sourceId, enabled: true },
        }),
      ),
    ]);

    await this.prisma.profile.update({
      where: { id: profileId },
      data: { nextRunAt: this.rearmNextRun(await this.profileSchedule(profileId)) },
    });

    return this.get(user, profileId);
  }

  async updateSourceSelection(
    user: AuthPayload,
    profileId: string,
    sourceId: string,
    input: SourceSelectionInput,
  ) {
    await this.access.assertProfile(user, profileId);

    const selection = await this.prisma.profileSource.findUnique({
      where: { profileId_sourceId: { profileId, sourceId } },
    });
    if (!selection) {
      throw new NotFoundException('Ese perfil no tiene seleccionada esa fuente.');
    }

    return this.prisma.profileSource.update({
      where: { profileId_sourceId: { profileId, sourceId } },
      data: {
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        ...(input.intervalHours === undefined ? {} : { intervalHours: input.intervalHours }),
      },
    });
  }

  async removeSourceSelection(user: AuthPayload, profileId: string, sourceId: string): Promise<void> {
    await this.access.assertProfile(user, profileId);

    const selection = await this.prisma.profileSource.findUnique({
      where: { profileId_sourceId: { profileId, sourceId } },
    });
    if (!selection) {
      throw new NotFoundException('Ese perfil no tiene seleccionada esa fuente.');
    }

    await this.prisma.profileSource.delete({
      where: { profileId_sourceId: { profileId, sourceId } },
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async profileSchedule(profileId: string): Promise<number | null> {
    const profile = await this.prisma.profile.findUnique({
      where: { id: profileId },
      select: { scheduleHours: true },
    });
    return profile?.scheduleHours ?? null;
  }

  private async assertAccount(profileId: string, accountId: string): Promise<void> {
    const account = await this.prisma.socialAccount.findFirst({
      where: { id: accountId, profileId },
      select: { id: true },
    });
    if (!account) throw new NotFoundException(`La cuenta ${accountId} no existe en ese perfil.`);
  }

  private async assertObjective(profileId: string, objectiveId: string): Promise<void> {
    const objective = await this.prisma.objective.findFirst({
      where: { id: objectiveId, profileId },
      select: { id: true },
    });
    if (!objective) throw new NotFoundException(`El objetivo ${objectiveId} no existe en ese perfil.`);
  }
}

/** `P2002` = violación de índice único en Prisma. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
}
