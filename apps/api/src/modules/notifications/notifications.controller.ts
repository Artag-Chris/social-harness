import { Controller, Get, HttpCode, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthPayload } from '../auth/auth.types';
import { NotificationsService } from './notifications.service';

/**
 * Bandeja de avisos del dashboard (el canal `dashboard` del `NotificationPort`).
 * Se lee por polling, como el resto del front.
 */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiQuery({ name: 'unread', required: false, type: Boolean })
  @ApiOperation({ summary: 'Avisos del usuario (y cuántos sin leer)' })
  list(@CurrentUser() user: AuthPayload, @Query('unread') unread?: string) {
    return this.notifications.list(user, unread === 'true' || unread === '1');
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Marcar todos como leídos' })
  async readAll(@CurrentUser() user: AuthPayload): Promise<{ updated: number }> {
    return { updated: await this.notifications.markAllRead(user) };
  }

  @Patch(':id/read')
  @HttpCode(204)
  @ApiOperation({ summary: 'Marcar un aviso como leído' })
  async read(@CurrentUser() user: AuthPayload, @Param('id') id: string): Promise<void> {
    await this.notifications.markRead(user, id);
  }
}
