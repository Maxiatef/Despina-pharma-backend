/**
 * Due dates counted in business hours (owner decision: hours, days and response target are configurable).
 *
 *   BUSINESS_HOURS=09:00-17:00        opening hours, local to BUSINESS_TIMEZONE
 *   BUSINESS_DAYS=1-5                 ISO weekdays (1 = Monday … 7 = Sunday), e.g. "1-5" or "1,2,3,4,6"
 *   BUSINESS_TIMEZONE=UTC             IANA zone, e.g. Africa/Cairo
 *   FOLLOW_UP_BUSINESS_HOURS=8        response target for a new inquiry (8 = one business day)
 */
const STEP_MIN = 15;

function parseDays(spec: string): Set<number> {
  const days = new Set<number>();
  for (const part of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [a, b] = part.split('-').map(Number);
    for (let d = a; d <= (b || a); d++) if (d >= 1 && d <= 7) days.add(d);
  }
  return days.size ? days : new Set([1, 2, 3, 4, 5]);
}

function parseHours(spec: string): [number, number] {
  const m = spec.match(/^(\d{1,2}):?(\d{2})?\s*-\s*(\d{1,2}):?(\d{2})?$/);
  if (!m) return [9 * 60, 17 * 60];
  const start = Number(m[1]) * 60 + Number(m[2] ?? 0);
  const end = Number(m[3]) * 60 + Number(m[4] ?? 0);
  return end > start ? [start, end] : [9 * 60, 17 * 60];
}

export function businessConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    days: parseDays(env.BUSINESS_DAYS ?? '1-5'),
    hours: parseHours(env.BUSINESS_HOURS ?? '09:00-17:00'),
    timeZone: env.BUSINESS_TIMEZONE || 'UTC',
    followUpHours: Math.max(1, Number(env.FOLLOW_UP_BUSINESS_HOURS ?? 8) || 8),
  };
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Weekday (1–7) and minute of the day of `date` in `timeZone`. */
function localParts(fmt: Intl.DateTimeFormat, date: Date) {
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { day: WEEKDAYS[p.weekday], minute: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}

/** `from` + N business hours (15-minute precision). */
export function addBusinessHours(from: Date, hours: number, cfg = businessConfig()): Date {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone: cfg.timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  } catch {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  }
  const [open, close] = cfg.hours;
  let remaining = Math.round(hours * 60);
  // Start on a 15-minute boundary so the walk is exact.
  let t = Math.ceil(from.getTime() / (STEP_MIN * 60_000)) * STEP_MIN * 60_000;
  for (let guard = 0; remaining > 0 && guard < 60 * 24 * 4 * 2; guard++) {
    const { day, minute } = localParts(fmt, new Date(t));
    if (cfg.days.has(day) && minute >= open && minute < close) remaining -= STEP_MIN;
    t += STEP_MIN * 60_000;
  }
  return new Date(t);
}
