// The ECB publishes reference rates around 16:00 Frankfurt time on working days.
const TIME_ZONE = 'Europe/Berlin';
const PUBLISH_HOUR = 16;

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function frankfurtParts(epochMs: number) {
  const parts = Object.fromEntries(formatter.formatToParts(epochMs).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function frankfurtOffsetMs(epochMs: number): number {
  const p = frankfurtParts(epochMs);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - Math.floor(epochMs / 1000) * 1000;
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function isWeekday(date: string): boolean {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

/** Frankfurt calendar date (YYYY-MM-DD) of an instant. */
export function ecbDate(epochMs: number): string {
  const { year, month, day } = frankfurtParts(epochMs);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Instant the rates for an ECB date are published: 16:00 Frankfurt time, CET or CEST. */
export function publishAt(date: string): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const naive = Date.UTC(year, month - 1, day, PUBLISH_HOUR);
  // DST switches at 01:00 UTC, so the offset at 16:00 UTC equals the offset at the publish instant.
  return naive - frankfurtOffsetMs(naive);
}

/** Most recent weekday publish time at or before now. Ignores ECB holidays; see DECISIONS.md. */
export function latestPublishAt(now: number): number {
  const today = ecbDate(now);
  for (let daysBack = 0; daysBack < 7; daysBack++) {
    const date = addDays(today, -daysBack);
    if (!isWeekday(date)) continue;
    const publish = publishAt(date);
    if (publish <= now) return publish;
  }
  throw new Error('No weekday in the past week');
}
