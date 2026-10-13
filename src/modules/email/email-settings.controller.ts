import { BadRequestException, Body, Controller, Get, Header, HttpCode, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../../common/decorators/auth.decorators.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { SettingsService } from '../settings/settings.service.js';
import { EmailService } from './email.service.js';
import { renderTemplate, TEMPLATE_NAMES } from './email.templates.js';
import type { TemplateName } from './email.templates.js';
import {
  ACCOUNT_EMAILS, CUSTOMER_EMAILS, EMAIL_SETTING_KEYS, SETTING_KEYS, STAFF_NOTIFICATIONS, isValidEmail, parseRecipients,
} from './email-settings.js';

class UpdateEmailSettingsDto {
  @ApiProperty({ description: 'Setting key → value ("true"/"false" for switches, comma-separated e-mails for recipients)' })
  @IsObject() values: Record<string, string | null>;
}

class TestEmailDto {
  @ApiProperty() @IsEmail() to: string;
}

/** Sample data so every template can be previewed. */
const SAMPLE: Record<string, unknown> = {
  referenceNo: 'DP-INQ-2026-000123', formType: 'contact', inquiryType: 'Quotation / pricing', contactName: 'Sara Ali',
  contactEmail: 'sara@glow-cosmetics.com', phone: '+20 100 000 0000', companyName: 'Glow Cosmetics', items: ['Active Botanical Face Serum'],
  message: 'We would like a quote for 2,000 units of a 30 ml face serum.', sourcePage: '/contact/', followUpDue: new Date(Date.now() + 86_400_000).toISOString(),
  answers: [['Inquiry type', 'Quotation / pricing'], ['Your question', 'Price for 2,000 units?']], projectId: '00000000-0000-0000-0000-000000000000',
  inquiryId: '00000000-0000-0000-0000-000000000000', projectCode: 'DP-PRJ-2026-0001', projectName: 'Glow Cosmetics – Face serum', quoteNo: 'DP-PRJ-2026-0001-Q1',
  versionNo: 2, total: '4600.00', currency: 'USD', validUntil: '2026-11-30', decision: 'changes_requested', note: 'Please quote 3,000 units instead.',
  customerEmail: 'sara@glow-cosmetics.com', what: 'sample revision 2', confirmationText: 'I approve sample revision 2', sampleTitle: 'Face serum – version A',
  revisionNo: 2, productName: 'Face serum 30 ml', trackingNo: '1Z999AA10123456784', shippedAt: new Date().toISOString(), rating: 4, comments: 'Lovely texture, scent a bit strong.',
  title: 'Follow up DP-INQ-2026-000123 (Contact – Quotation / pricing)', dueAt: new Date(Date.now() + 86_400_000).toISOString(), priority: 'normal',
  forRef: 'DP-INQ-2026-000123', assignedBy: 'anna@despina.com', status: 'assigned', tasks: ['Follow up DP-INQ-2026-000123 (due 2026-10-08)'],
  senderName: 'Anna from Despina Pharma', body: 'Could you share your target retail price and launch date?', completedStage: 'Formulation', nextStage: 'Sampling',
  filename: 'Formula-spec-v2.pdf', toEmail: 'buyer@example.com', subject: 'Your quote DP-PRJ-2026-0001-Q1 is ready', error: 'Bounced: mailbox does not exist', attempts: 5,
  token: 'preview-token', role: 'customer', requestedBy: 'admin@despina.com', sender: 'Despina Pharma <onboarding@resend.dev>',
};

/** Admin → Settings → Emails. Admins only; every change is in the audit log. */
@ApiTags('settings')
@ApiBearerAuth()
@Roles('admin')
@Controller('settings/email')
export class EmailSettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly email: EmailService,
  ) {}

  @Get()
  async get() {
    const values = await this.settings.getMany(EMAIL_SETTING_KEYS);
    return {
      values,
      status: await this.email.status(),
      staffNotifications: STAFF_NOTIFICATIONS,
      customerEmails: CUSTOMER_EMAILS,
      accountEmails: ACCOUNT_EMAILS,
      templates: TEMPLATE_NAMES,
    };
  }

  @Patch()
  async update(@Body() dto: UpdateEmailSettingsDto, @CurrentUser() user: AuthUser) {
    const patch: Record<string, string | null> = {};
    for (const [key, raw] of Object.entries(dto.values)) {
      if (!EMAIL_SETTING_KEYS.has(key)) throw new BadRequestException(`Unknown setting "${key}"`);
      const value = raw === null || raw === undefined ? null : String(raw).trim();
      if (key.endsWith('.enabled') && value !== null && value !== 'true' && value !== 'false') throw new BadRequestException(`"${key}" must be true or false`);
      if (key.endsWith('.to') && value) {
        const bad = value.split(/[,;\s]+/).filter((v) => v && !isValidEmail(v));
        if (bad.length) throw new BadRequestException(`Not an e-mail address: ${bad.join(', ')}`);
        patch[key] = parseRecipients(value).join(', ');
        continue;
      }
      if ((key === SETTING_KEYS.senderEmail || key === SETTING_KEYS.replyTo) && value && !isValidEmail(value)) {
        throw new BadRequestException(`Not an e-mail address: ${value}`);
      }
      if (key === SETTING_KEYS.senderName && value && value.length > 80) throw new BadRequestException('Sender name is too long');
      patch[key] = value || null;
    }
    // A switched-on list notification needs at least one address (here or in .env).
    for (const n of STAFF_NOTIFICATIONS.filter((x) => x.recipients === 'list')) {
      const enabledKey = SETTING_KEYS.notifyEnabled(n.key);
      const toKey = SETTING_KEYS.notifyTo(n.key);
      const enabled = (enabledKey in patch ? patch[enabledKey] : await this.settings.get(enabledKey)) !== 'false';
      const to = toKey in patch ? patch[toKey] : await this.settings.get(toKey);
      if (enabled && toKey in patch && !to && !this.email.ownerEmail) {
        throw new BadRequestException(`Set a recipient before switching on "${n.label}"`);
      }
    }
    await this.settings.set(patch, user.id);
    return this.get();
  }

  @Post('test')
  @HttpCode(200)
  async test(@Body() dto: TestEmailDto, @CurrentUser() user: AuthUser) {
    const job = await this.email.sendTest(dto.to, user.email);
    return { status: job.status, error: job.lastError, providerMessageId: job.providerMessageId, jobId: job.id };
  }

  /** HTML preview of a template with sample data. */
  @Get('preview/:template')
  @Header('Content-Type', 'text/html; charset=utf-8')
  preview(@Param('template') template: string) {
    if (!TEMPLATE_NAMES.includes(template as TemplateName)) throw new NotFoundException('Unknown template');
    return renderTemplate(template as TemplateName, SAMPLE, this.email.appUrl).html;
  }
}
