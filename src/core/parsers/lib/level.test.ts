import { describe, expect, it } from 'vitest';
import {
  levelFromHttpStatus,
  levelFromSyslogSeverity,
  normalizeLevel,
} from './level.ts';

describe('normalizeLevel', () => {
  it('maps pino numeric levels', () => {
    expect(normalizeLevel(10)).toBe('trace');
    expect(normalizeLevel(30)).toBe('info');
    expect(normalizeLevel(50)).toBe('error');
    expect(normalizeLevel(60)).toBe('fatal');
  });

  it('maps syslog severities', () => {
    expect(normalizeLevel(0)).toBe('fatal');
    expect(normalizeLevel(4)).toBe('warn');
    expect(normalizeLevel(7)).toBe('debug');
  });

  it('canonicalises string aliases', () => {
    expect(normalizeLevel('WARNING')).toBe('warn');
    expect(normalizeLevel('err')).toBe('error');
    expect(normalizeLevel('crit')).toBe('fatal');
    expect(normalizeLevel('notice')).toBe('info');
    expect(normalizeLevel('verbose')).toBe('debug');
    expect(normalizeLevel('  Info  ')).toBe('info');
  });

  it('returns unknown for unrecognised input', () => {
    expect(normalizeLevel(null)).toBe('unknown');
    expect(normalizeLevel(undefined)).toBe('unknown');
    expect(normalizeLevel('whatever')).toBe('unknown');
    expect(normalizeLevel({ level: 5 })).toBe('unknown');
  });
});

describe('levelFromHttpStatus', () => {
  it('maps response classes to levels', () => {
    expect(levelFromHttpStatus(200)).toBe('info');
    expect(levelFromHttpStatus(304)).toBe('info');
    expect(levelFromHttpStatus(404)).toBe('warn');
    expect(levelFromHttpStatus(499)).toBe('warn');
    expect(levelFromHttpStatus(500)).toBe('error');
    expect(levelFromHttpStatus(503)).toBe('error');
  });
});

describe('levelFromSyslogSeverity', () => {
  it('maps RFC 5424 severities', () => {
    expect(levelFromSyslogSeverity(0)).toBe('fatal');
    expect(levelFromSyslogSeverity(2)).toBe('error');
    expect(levelFromSyslogSeverity(4)).toBe('warn');
    expect(levelFromSyslogSeverity(6)).toBe('info');
    expect(levelFromSyslogSeverity(99)).toBe('unknown');
  });
});
