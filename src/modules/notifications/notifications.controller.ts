import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { CurrentUser } from '../../common/decorators/auth.decorators.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';

/** The bell: the signed-in person's latest notifications. Rows are written by EmailService.queue. */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly ds: DataSource) {}

  @Get()
  async list(@CurrentUser() u: AuthUser) {
    const items = await this.ds.query(
      `SELECT id, title, link, read_at AS "readAt", created_at AS "createdAt" FROM notifications
        WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30`, [u.id]);
    const [{ unread, unreadProjects }] = await this.ds.query(
      `SELECT count(*)::int AS unread, count(project_id)::int AS "unreadProjects" FROM notifications WHERE user_id = $1 AND read_at IS NULL`, [u.id]);
    return { items, unread, unreadProjects };
  }

  @Post('read') @HttpCode(200)
  async readAll(@CurrentUser() u: AuthUser) {
    await this.ds.query(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`, [u.id]);
    return { ok: true };
  }
}
