import { describe, expect, it } from 'vitest';
import { parseApacheTime, parseSyslogTime, parseTimestamp } from './time.ts';

describe('parseTimestamp', () => {
  it('passes through milliseconds-scale numbers', () => {
    expect(parseTimestamp(1_700_000_000_000)).toBe(1_700_000_000_000);
  });

  it('upgrades seconds-scale numbers to ms', () => {
    expect(parseTimestamp(1_700_000_000)).toBe(1_700_000_000_000);
  });

  it('parses ISO-8601 strings', () => {
    expect(parseTimestamp('2024-01-01T10:00:00Z')).toBe(
      Date.parse('2024-01-01T10:00:00Z'),
    );
  });

  it('returns null for unparseable input', () => {
    expect(parseTimestamp(null)).toBeNull();
    expect(parseTimestamp(undefined)).toBeNull();
    expect(parseTimestamp('not a date')).toBeNull();
    expect(parseTimestamp({})).toBeNull();
  });
});

describe('parseApacheTime', () => {
  it('parses combined-log time_local', () => {
    expect(parseApacheTime('05/May/2026:06:00:00 +0000')).toBe(
      Date.UTC(2026, 4, 5, 6, 0, 0),
    );
  });

  it('applies timezone offset', () => {
    expect(parseApacheTime('05/May/2026:06:00:00 +0300')).toBe(
      Date.UTC(2026, 4, 5, 3, 0, 0),
    );
    expect(parseApacheTime('05/May/2026:06:00:00 -0500')).toBe(
      Date.UTC(2026, 4, 5, 11, 0, 0),
    );
  });

  it('returns null on malformed input', () => {
    expect(parseApacheTime('not a date')).toBeNull();
    expect(parseApacheTime('05/Foo/2026:06:00:00 +0000')).toBeNull();
  });
});

describe('parseSyslogTime', () => {
  it('parses Mon DD HH:MM:SS with current year', () => {
    const now = Date.UTC(2026, 5, 1, 12, 0, 0);
    expect(parseSyslogTime('May  5 06:00:00', now)).toBe(
      Date.UTC(2026, 4, 5, 6, 0, 0),
    );
  });

  it('rolls back to previous year for future-looking dates', () => {
    // viewing on Jan 15, 2026; line dated Dec 25 → assume 2025
    const now = Date.UTC(2026, 0, 15, 12, 0, 0);
    expect(parseSyslogTime('Dec 25 10:00:00', now)).toBe(
      Date.UTC(2026, 11, 25, 10, 0, 0) - 365 * 86_400_000,
    );
  });

  it('returns null for unparseable input', () => {
    expect(parseSyslogTime('something')).toBeNull();
  });
});
