import { BadRequestException, Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsObject, IsString, MaxLength } from 'class-validator';
import { CurrentUser, Public, Roles, StaffOnly } from '../../common/decorators/auth.decorators.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { esc } from '../email/email.templates.js';
import { SettingsService } from '../settings/settings.service.js';
import { AuditService } from '../audit/audit.service.js';
import { REMINDER_KEYS, RemindersService, validateReminderSetting } from './reminders.service.js';

class ReminderKeyDto {
  @ApiProperty() @IsString() @MaxLength(120) key: string;
}

class StopDto {
  @ApiProperty() @IsString() @MaxLength(254) e: string;
  @ApiProperty() @IsString() @MaxLength(100) t: string;
}

class ReminderSettingsDto {
  @ApiProperty({ description: 'Setting key → value; empty or null = default' }) @IsObject() values: Record<string, string | null>;
}

const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>body{margin:0;background:#f4f6f9;font:16px/1.6 Arial,Helvetica,sans-serif;color:#1d2939}main{max-width:520px;margin:64px auto;padding:32px 28px;background:#fff;border:1px solid #e4e7ec;border-radius:14px}h1{margin:0 0 12px;font:normal 26px Georgia,serif;color:#112a46}button{margin-top:12px;padding:12px 26px;border:0;border-radius:999px;background:#112a46;color:#fff;font:600 15px Arial,sans-serif;cursor:pointer}p.small{color:#667085;font-size:13px}</style></head>
<body><main>${body}</main></body></html>`;

/** Waiting list (waiting on the customer / on us), reminder pause and settings, and the customer's "stop reminders" link. */
@ApiTags('reminders')
@ApiBearerAuth()
@Controller()
export class RemindersController {
  constructor(private readonly reminders: RemindersService, private readonly settings: SettingsService, private readonly audit: AuditService) {}

  @StaffOnly() @Get('reminders') overview() { return this.reminders.overview(); }
  @StaffOnly() @Post('reminders/pause') @HttpCode(200) pause(@Body() dto: ReminderKeyDto, @CurrentUser() u: AuthUser) { return this.reminders.pause(dto.key, true, u.id); }
  @StaffOnly() @Post('reminders/resume') @HttpCode(200) resume(@Body() dto: ReminderKeyDto, @CurrentUser() u: AuthUser) { return this.reminders.pause(dto.key, false, u.id); }
  @StaffOnly() @Post('reminders/send') @HttpCode(200) send(@Body() dto: ReminderKeyDto) { return this.reminders.sendNow(dto.key); }
  @Roles('admin') @Post('reminders/run') @HttpCode(200) run() { return this.reminders.run(); }

  @Roles('admin') @Patch('reminders/settings')
  async updateSettings(@Body() dto: ReminderSettingsDto, @CurrentUser() u: AuthUser) {
    const patch: Record<string, string | null> = {};
    const errors: string[] = [];
    for (const [key, raw] of Object.entries(dto.values)) {
      if (!(REMINDER_KEYS as readonly string[]).includes(key)) { errors.push(`Unknown setting: ${key}`); continue; }
      const value = raw?.trim() || null;
      const err = value && validateReminderSetting(key, value);
      if (err) { errors.push(`${key}: ${err}`); continue; }
      patch[key] = value;
    }
    if (errors.length) throw new BadRequestException(errors);
    const before = await this.settings.getMany(Object.keys(patch));
    await this.settings.set(patch, u.id);
    await this.audit.log({ actorId: u.id, action: 'settings.reminders', entityType: 'settings', entityId: null, before, after: patch });
    return this.reminders.config();
  }

  @StaffOnly() @Post('contacts/:id/reminders-on') @HttpCode(200)
  remindersOn(@Param('id', ParseUUIDPipe) id: string) { return this.reminders.turnOn(id); }

  /** The link in reminder e-mails opens a page with a button, so a mail scanner opening the link changes nothing. */
  @Public() @Get('reminders/stop') @Header('Content-Type', 'text/html; charset=utf-8')
  stopPage(@Query('e') e = '', @Query('t') t = '') {
    if (!this.reminders.checkStopToken(e, t)) {
      return page('Link not valid', '<h1>This link is not valid</h1><p>Please use the link from the latest reminder e-mail, or reply to it and we will turn reminders off for you.</p>');
    }
    return page('Stop reminder e-mails', `<h1>Stop reminder e-mails?</h1><p>We will stop sending reminder e-mails to <strong>${esc(e)}</strong>. You will still get replies and updates about your projects.</p>
<form method="post" action="stop"><input type="hidden" name="e" value="${esc(e)}"><input type="hidden" name="t" value="${esc(t)}"><button type="submit">Stop reminders</button></form>`);
  }

  @Public() @Post('reminders/stop') @HttpCode(200) @Header('Content-Type', 'text/html; charset=utf-8')
  async stop(@Body() dto: StopDto) {
    if (!this.reminders.checkStopToken(dto.e, dto.t)) return page('Link not valid', '<h1>This link is not valid</h1>');
    await this.reminders.turnOff(dto.e);
    return page('Reminders stopped', '<h1>Done</h1><p>You will not get reminder e-mails from Despina Pharma any more.</p><p class="small">Changed your mind? Just reply to any of our e-mails.</p>');
  }
}
