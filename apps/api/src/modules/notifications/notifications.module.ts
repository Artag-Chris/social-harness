import { Global, Module } from '@nestjs/common';
import { features } from '../../config/features';
import { DashboardNotificationAdapter } from './dashboard/dashboard-notification.adapter';
import { NOTIFICATION_CHANNELS_TOKEN, type NotificationPort } from './notification.port';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * Avisos: resuelve los canales desde `NOTIFY_CHANNELS` y publica `NotificationsService`.
 *
 * Global porque lo usan el análisis, la recolección y (más adelante) el reporte de
 * rendimiento: cualquiera avisa sin conocer el transporte.
 */
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [
    DashboardNotificationAdapter,
    {
      provide: NOTIFICATION_CHANNELS_TOKEN,
      useFactory: (dashboard: DashboardNotificationAdapter): NotificationPort[] => {
        // `dashboard` (la bandeja) siempre está, aunque el .env no lo liste: es
        // donde quedan los avisos si un canal externo falla.
        const adapters: Record<string, NotificationPort> = { dashboard };
        return features.notifications.channels
          .map((channel) => adapters[channel])
          .filter((adapter): adapter is NotificationPort => adapter !== undefined);
      },
      inject: [DashboardNotificationAdapter],
    },
    NotificationsService,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
