import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { NotificationEvent, NotificationPort } from '../notification.port';

/**
 * Adaptador `dashboard`: el aviso queda como una fila en la bandeja y el dashboard
 * lo lee por polling.
 *
 * Es el único canal activo en v1 y el que **siempre** está: los canales externos
 * (WhatsApp, Discord) serán adicionales, no reemplazos — si un webhook se cae, el
 * aviso igual tiene que estar en alguna parte.
 */
@Injectable()
export class DashboardNotificationAdapter implements NotificationPort {
  readonly channel = 'dashboard';

  constructor(private readonly prisma: PrismaService) {}

  async send(event: NotificationEvent): Promise<void> {
    await this.prisma.notification.create({
      data: {
        type: event.type,
        title: event.title,
        body: event.body,
        profileId: event.profileId ?? null,
        payload: (event.payload ?? {}) as Prisma.InputJsonValue,
      },
    });
  }
}
