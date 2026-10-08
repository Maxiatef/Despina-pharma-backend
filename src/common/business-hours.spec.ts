import { addBusinessHours, businessConfig } from './business-hours.js';

const cfg = (env: Record<string, string> = {}) => businessConfig({ BUSINESS_TIMEZONE: 'UTC', ...env } as NodeJS.ProcessEnv);

describe('addBusinessHours', () => {
  it('stays inside the same working day', () => {
    // Wednesday 2026-10-07 10:00 UTC + 4h → 14:00
    expect(addBusinessHours(new Date('2026-10-07T10:00:00Z'), 4, cfg()).toISOString()).toBe('2026-10-07T14:00:00.000Z');
  });

  it('carries over to the next working day', () => {
    // Wednesday 15:00 + 8h → 2h today, 6h Thursday from 09:00 → Thursday 15:00
    expect(addBusinessHours(new Date('2026-10-07T15:00:00Z'), 8, cfg()).toISOString()).toBe('2026-10-08T15:00:00.000Z');
  });

  it('skips the weekend', () => {
    // Friday 2026-10-09 16:00 + 8h → 1h Friday, 7h Monday → Monday 16:00
    expect(addBusinessHours(new Date('2026-10-09T16:00:00Z'), 8, cfg()).toISOString()).toBe('2026-10-12T16:00:00.000Z');
  });

  it('a submission at night starts counting at opening time', () => {
    // Saturday 23:00 + 2h → Monday 11:00
    expect(addBusinessHours(new Date('2026-10-10T23:00:00Z'), 2, cfg()).toISOString()).toBe('2026-10-12T11:00:00.000Z');
  });

  it('respects configured days, hours and time zone', () => {
    // Sunday–Thursday 08:00–16:00 in Cairo (UTC+3 in October 2026 DST → 05:00–13:00 UTC)
    const c = cfg({ BUSINESS_DAYS: '7,1-4', BUSINESS_HOURS: '08:00-16:00', BUSINESS_TIMEZONE: 'Africa/Cairo' });
    // Thursday 2026-10-08 12:00 UTC (15:00 Cairo) + 2h → 1h Thursday, 1h Sunday from 08:00 → Sunday 09:00 Cairo
    const due = addBusinessHours(new Date('2026-10-08T12:00:00Z'), 2, c);
    const local = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(due);
    expect(local).toBe('Sun 09:00');
  });

  it('falls back to safe defaults for bad settings', () => {
    const c = businessConfig({ BUSINESS_HOURS: 'nonsense', BUSINESS_DAYS: '', FOLLOW_UP_BUSINESS_HOURS: 'x' } as NodeJS.ProcessEnv);
    expect(c.hours).toEqual([540, 1020]);
    expect([...c.days]).toEqual([1, 2, 3, 4, 5]);
    expect(c.followUpHours).toBe(8);
  });
});
