import type { LogLevel } from '../../types/log-entry.ts';

/**
 * Pino numeric levels (10 trace → 60 fatal). The default JSON-logger
 * convention; rare outside pino/winston/bunyan but useful enough to
 * keep alongside syslog mapping.
 */
const PINO_LEVEL_NUMERIC: Readonly<Record<number, LogLevel>> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
};

/**
 * RFC 5424 severities (0 emerg … 7 debug). Used by syslog and many
 * UNIX daemons; fits one-byte priority fields.
 */
const SYSLOG_LEVEL_NUMERIC: Readonly<Record<number, LogLevel>> = {
  0: 'fatal',
  1: 'fatal',
  2: 'error',
  3: 'error',
  4: 'warn',
  5: 'info',
  6: 'info',
  7: 'debug',
};

/**
 * Best-effort normalisation of a level value from any parser. Accepts
 * numbers (pino/syslog scales), strings (case-insensitive aliases),
 * `undefined`/`null` (→ `'unknown'`). Aliases follow common logger
 * vocabulary: `warning` → `warn`, `critical`/`crit`/`emerg`/`alert`
 * → `fatal`, `err` → `error`, `notice`/`information`/`inf` → `info`,
 * `dbg`/`verbose` → `debug`.
 */
export const normalizeLevel = (value: unknown): LogLevel => {
  if (typeof value === 'number') {
    return (
      PINO_LEVEL_NUMERIC[value] ?? SYSLOG_LEVEL_NUMERIC[value] ?? 'unknown'
    );
  }
  if (typeof value !== 'string') return 'unknown';
  const v = value.trim().toLowerCase();
  switch (v) {
    case 'trace':
    case 'debug':
    case 'info':
    case 'warn':
    case 'error':
    case 'fatal':
      return v;
    case 'warning':
      return 'warn';
    case 'critical':
    case 'crit':
    case 'emergency':
    case 'emerg':
    case 'alert':
      return 'fatal';
    case 'err':
      return 'error';
    case 'inf':
    case 'information':
    case 'notice':
      return 'info';
    case 'dbg':
    case 'verbose':
      return 'debug';
    default:
      return 'unknown';
  }
};

/**
 * HTTP-style level derivation. 5xx → error, 4xx → warn, everything
 * else (1xx/2xx/3xx) → info. Used by nginx/apache/proxy parsers
 * where there's no explicit level field.
 */
export const levelFromHttpStatus = (status: number): LogLevel => {
  if (status >= 500) return 'error';
  if (status >= 400) return 'warn';
  return 'info';
};

/**
 * Syslog severity → LogLevel. Convenience wrapper over the same map
 * that `normalizeLevel` uses for numbers, but exported separately for
 * parsers that need explicit syslog semantics (e.g. RFC 3164 with
 * `<priority>` byte).
 */
export const levelFromSyslogSeverity = (severity: number): LogLevel =>
  SYSLOG_LEVEL_NUMERIC[severity] ?? 'unknown';
