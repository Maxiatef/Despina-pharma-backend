import { Controller, Get, Headers, Logger, UnauthorizedException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { timingSafeEqual } from 'node:crypto';
import { Public } from '../../common/decorators/auth.decorators.js';
import { EmailService } from '../email/email.service.js';
import { TasksService } from '../tasks/tasks.service.js';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import { AuthService } from '../auth/auth.service.js';

/**
 * Scheduled jobs for serverless hosting (Vercel Cron, see vercel.json).
 * Vercel sends `Authorization: Bearer <CRON_SECRET>`; anything else is rejected.
 * On a normal always-on server the same jobs run from in-process timers instead.
 */
@ApiTags('cron')
@Controller('cron')
export class CronController {
  private readonly logger = new Logger('Cron');

  constructor(
    private readonly email: EmailService,
    private readonly tasks: TasksService,
    private readonly rateLimit: RateLimitService,
    private readonly auth: AuthService,
  ) {}

  private check(authorization?: string) {
    const secret = process.env.CRON_SECRET;
    const expected = Buffer.from(`Bearer ${secret ?? ''}`);
    const given = Buffer.from(authorization ?? '');
    if (!secret || expected.length !== given.length || !timingSafeEqual(expected, given)) throw new UnauthorizedException();
  }

  /** GET /api/cron/run – email queue, overdue-task reminders, cleanup. */
  @Public()
  @Get('run')
  async run(@Headers('authorization') authorization?: string) {
    this.check(authorization);
    await this.email.processQueue();
    const digest = await this.tasks.sendOverdueDigest();
    await this.rateLimit.cleanup();
    await this.auth.purgeExpiredSessions();
    this.logger.log(`cron run: overdue digests ${digest.sent}`);
    return { ok: true, overdueDigests: digest.sent };
  }

  /** GET /api/cron/email-queue – only the email queue (for a more frequent schedule). */
  @Public()
  @Get('email-queue')
  async emailQueue(@Headers('authorization') authorization?: string) {
    this.check(authorization);
    await this.email.processQueue();
    return { ok: true };
  }
}
