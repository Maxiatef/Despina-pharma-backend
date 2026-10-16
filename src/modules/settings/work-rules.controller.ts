import { BadRequestException, Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsObject } from 'class-validator';
import { DataSource } from 'typeorm';
import { CurrentUser, Roles } from '../../common/decorators/auth.decorators.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { STAFF_ROLES } from '../../common/enums.js';
import { User } from '../../database/entities/index.js';
import { AuditService } from '../audit/audit.service.js';
import { SettingsService } from './settings.service.js';
import { RULE_KEYS, leadRule, loadBusinessConfig, validateRule } from './work-rules.js';
import { FORM_TYPES } from '../../common/enums.js';

class UpdateRulesDto {
  @ApiProperty({ description: 'Rule key → value; empty or null = use the .env fallback' })
  @IsObject() values: Record<string, string | null>;
}

/** Admin → Settings → Rules: who gets new leads, follow-up priority and business hours. */
@ApiTags('settings')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin/settings/rules')
export class WorkRulesController {
  constructor(private readonly settings: SettingsService, private readonly ds: DataSource, private readonly audit: AuditService) {}

  @Get()
  async get() {
    const values = await this.settings.getMany(RULE_KEYS);
    const cfg = await loadBusinessConfig(this.settings);
    const effective = Object.fromEntries(await Promise.all(FORM_TYPES.map(async (f) => [f, await leadRule(this.settings, f)])));
    return {
      values,
      effective: { ...effective, followUpHours: cfg.followUpHours, timeZone: cfg.timeZone },
      fallback: {
        business_hours: process.env.BUSINESS_HOURS ?? '09:00-17:00', business_days: process.env.BUSINESS_DAYS ?? '1-5',
        timezone: process.env.BUSINESS_TIMEZONE || 'UTC', follow_up_hours: process.env.FOLLOW_UP_BUSINESS_HOURS ?? '8',
      },
    };
  }

  @Patch()
  async update(@Body() dto: UpdateRulesDto, @CurrentUser() user: AuthUser) {
    const patch: Record<string, string | null> = {};
    const errors: string[] = [];
    for (const [key, raw] of Object.entries(dto.values)) {
      if (!RULE_KEYS.includes(key)) { errors.push(`Unknown rule: ${key}`); continue; }
      const value = raw?.trim() || null;
      if (value && key.startsWith('rules.assign.')) {
        const u = await this.ds.getRepository(User).createQueryBuilder('u').where('lower(u.email) = lower(:e) AND u.isActive', { e: value }).getOne();
        if (!u || !STAFF_ROLES.includes(u.role)) { errors.push(`${value} is not an active staff member`); continue; }
      } else if (value) {
        const err = validateRule(key, value);
        if (err) { errors.push(err); continue; }
      }
      patch[key] = value;
    }
    if (errors.length) throw new BadRequestException(errors);
    const before = await this.settings.getMany(Object.keys(patch));
    await this.settings.set(patch, user.id);
    await this.audit.log({ actorId: user.id, action: 'settings.rules', entityType: 'settings', entityId: null, before, after: patch });
    return this.get();
  }
}
