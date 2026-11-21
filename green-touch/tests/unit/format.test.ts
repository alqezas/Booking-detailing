import {describe, expect, it} from 'vitest';
import {addDays, kyivDayStartUtc, kyivToday} from '../../src/lib/format.ts';

describe('admin date filter (Kyiv calendar days → UTC bounds)', () => {
  it('uses the Kyiv offset, including daylight saving time', () => {
    expect(kyivDayStartUtc('2026-11-15')).toBe('2026-11-14T22:00:00.000Z'); // winter, UTC+2
    expect(kyivDayStartUtc('2026-07-01')).toBe('2026-06-30T21:00:00.000Z'); // summer, UTC+3
  });
  it('shifts days across month and year ends', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30'); // DST switch day
  });
  it('today is the Kyiv date, not the UTC one', () => {
    expect(kyivToday(new Date('2026-11-15T22:30:00Z'))).toBe('2026-11-16');
  });
});
