import { FORM_TYPES } from '../../common/enums.js';
import type { FormType } from '../../common/enums.js';
import { businessConfig } from '../../common/business-hours.js';
import type { SettingsService } from './settings.service.js';

/**
 * Lead assignment and follow-up rules, editable in Admin → Settings → Rules (app_settings).
 * The .env values (AUTO_ASSIGN_*, BUSINESS_*, FOLLOW_UP_BUSINESS_HOURS) are only the fallback.
 *
 *   rules.assign.<formType> / rules.assign.default   staff e-mail that new leads of that form go to
 *   rules.priority.<formType>                        priority of the automatic follow-up task (low|normal|high|urgent)
 *   rules.business_hours / rules.business_days / rules.timezone / rules.follow_up_hours
 */
export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type TaskPriorityValue = (typeof TASK_PRIORITIES)[number];

const DEFAULT_PRIORITY: Record<FormType, TaskPriorityValue> = {
  contact: 'normal', new_customer: 'normal', new_product: 'normal', service: 'normal', sample_request: 'high', sample_feedback: 'high',
};

export const RULE_KEYS = [
  'rules.assign.default', ...FORM_TYPES.map((f) => `rules.assign.${f}`), ...FORM_TYPES.map((f) => `rules.priority.${f}`),
  'rules.business_hours', 'rules.business_days', 'rules.timezone', 'rules.follow_up_hours',
];

/** Business-hours config: settings first, then .env. */
export async function loadBusinessConfig(settings: SettingsService) {
  const s = await settings.getMany(['rules.business_hours', 'rules.business_days', 'rules.timezone', 'rules.follow_up_hours']);
  return businessConfig({
    ...process.env,
    BUSINESS_HOURS: s['rules.business_hours'] || process.env.BUSINESS_HOURS,
    BUSINESS_DAYS: s['rules.business_days'] || process.env.BUSINESS_DAYS,
    BUSINESS_TIMEZONE: s['rules.timezone'] || process.env.BUSINESS_TIMEZONE,
    FOLLOW_UP_BUSINESS_HOURS: s['rules.follow_up_hours'] || process.env.FOLLOW_UP_BUSINESS_HOURS,
  });
}

/** Who gets a new lead of this form type, and the follow-up task priority. */
export async function leadRule(settings: SettingsService, formType: FormType) {
  const s = await settings.getMany([`rules.assign.${formType}`, 'rules.assign.default', `rules.priority.${formType}`]);
  const assignee = (s[`rules.assign.${formType}`] || s['rules.assign.default']
    || process.env[`AUTO_ASSIGN_${formType.toUpperCase()}`] || process.env.AUTO_ASSIGN_DEFAULT || '').trim();
  const p = s[`rules.priority.${formType}`] as TaskPriorityValue | null;
  return { assigneeEmail: assignee, priority: p && TASK_PRIORITIES.includes(p) ? p : DEFAULT_PRIORITY[formType] };
}

/** Checks one value; returns an error message or null. */
export function validateRule(key: string, value: string): string | null {
  if (key.startsWith('rules.priority.')) return TASK_PRIORITIES.includes(value as TaskPriorityValue) ? null : 'Priority must be low, normal, high or urgent';
  if (key === 'rules.business_hours') {
    const m = value.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
    return m && Number(m[3]) * 60 + Number(m[4]) > Number(m[1]) * 60 + Number(m[2]) && Number(m[3]) <= 24 ? null : 'Opening hours look like 09:00-17:00';
  }
  if (key === 'rules.business_days') return /^[1-7](-[1-7])?(,[1-7](-[1-7])?)*$/.test(value.replace(/\s/g, '')) ? null : 'Days look like 1-5 (Monday–Friday) or 1,2,3,4,6';
  if (key === 'rules.timezone') {
    try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return null; } catch { return 'Unknown time zone, e.g. Africa/Cairo'; }
  }
  if (key === 'rules.follow_up_hours') return /^\d+(\.\d+)?$/.test(value) && Number(value) >= 1 && Number(value) <= 200 ? null : 'Response target is 1–200 business hours';
  return null;
}
