import { describe, expect, it } from 'vitest';
import { ecbDate, latestPublishAt, publishAt } from './ecbCalendar';

describe('ecbCalendar', () => {
  it('publishes at 16:00 Frankfurt time in both summer (CEST) and winter (CET)', () => {
    expect(new Date(publishAt('2026-10-02')).toISOString()).toBe('2026-10-02T14:00:00.000Z');
    expect(new Date(publishAt('2026-12-01')).toISOString()).toBe('2026-12-01T15:00:00.000Z');
  });

  it('uses the Frankfurt calendar date, not the UTC one', () => {
    expect(ecbDate(Date.parse('2026-10-05T22:30:00Z'))).toBe('2026-10-06');
  });

  it.each([
    ['weekday after publish -> same day', '2026-10-06T14:00:00Z', '2026-10-06T14:00:00.000Z'],
    ['weekday before publish -> previous weekday', '2026-10-06T13:59:59Z', '2026-10-05T14:00:00.000Z'],
    ['Monday morning -> Friday', '2026-10-05T08:00:00Z', '2026-10-02T14:00:00.000Z'],
    ['Sunday -> Friday', '2026-10-04T12:00:00Z', '2026-10-02T14:00:00.000Z'],
    ['across the DST change -> Friday in CEST', '2026-10-26T08:00:00Z', '2026-10-23T14:00:00.000Z'],
  ])('latestPublishAt: %s', (_label, now, expected) => {
    expect(new Date(latestPublishAt(Date.parse(now))).toISOString()).toBe(expected);
  });
});
