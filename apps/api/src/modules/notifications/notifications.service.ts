import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { JsonLogger } from '../../common/json-logger.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessScope } from '../auth/access-scope.service';
import type { AuthPayload } from '../auth/auth.types';
import {
  NOTIFICATION_CHANNELS_TOKEN,
  type NotificationEvent,
  type NotificationPort,
} from './notification.port';

/**
 * Bandeja de avisos + reparto por canal.
 *
 * `notify()` nunca lanza: un aviso que no se puede entregar no debe tumbar el
 * pipeline que lo emitió. Si un canal falla, se registra y siguen los demás.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessScope,
    private readonly logger: JsonLogger,
    @Inject(NOTIFICATION_CHANNELS_TOKEN) private readonly channels: NotificationPort[],
  ) {}

  /** Manda el aviso a todos los canales activos (fail-soft por canal). */
  async notify(event: NotificationEvent): Promise<void> {
    for (const channel of this.channels) {
      try {
        await channel.send(event);
      } catch (error) {
        this.logger.warn(
          {
            msg: 'Un canal de aviso falló (los demás siguen)',
            channel: channel.channel,
            type: event.type,
            error: error instanceof Error ? error.message : String(error),
          },
          'Notifications',
        );
      }
    }
  }

  async list(user: AuthPayload, onlyUnread: boolean) {
    const notifications = await this.prisma.notification.findMany({
      where: {
        // Los avisos del sistema (sin perfil) los ve cualquiera; los de un perfil,
        // solo quien lo alcanza.
        ...(onlyUnread ? { readAt: null } : {}),
        OR: [{ profileId: null }, { profile: this.access.profileWhere(user) }],
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { profile: { select: { id: true, name: true } } },
    });

    const unread = await this.prisma.notification.count({
      where: {
        readAt: null,
        OR: [{ profileId: null }, { profile: this.access.profileWhere(user) }],
      },
    });

    return { unread, count: notifications.length, notifications };
  }

  async markRead(user: AuthPayload, notificationId: string): Promise<void> {
    await this.assertReachable(user, notificationId);
    await this.prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(user: AuthPayload): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: {
        readAt: null,
        OR: [{ profileId: null }, { profile: this.access.profileWhere(user) }],
      },
      data: { readAt: new Date() },
    });
    return result.count;
  }

  private async assertReachable(user: AuthPayload, notificationId: string): Promise<void> {
    const found = await this.prisma.notification.findFirst({
      where: {
        id: notificationId,
        OR: [{ profileId: null }, { profile: this.access.profileWhere(user) }],
      },
      select: { id: true },
    });
    if (!found) throw new NotFoundException(`El aviso ${notificationId} no existe.`);
  }
}
