import { defineRegexParser } from './lib/regex-parser.ts';

/**
 * RFC 3164 / BSD-style syslog (the legacy format that most UNIX
 * boxes still emit by default):
 *
 *   [<priority>]<timestamp> <hostname> <program>[<pid>]: <message>
 *
 * Examples:
 *   May  5 06:00:00 myhost sshd[1234]: Accepted publickey for alice
 *   <34>Oct 11 22:14:15 mymachine su: 'su root' failed for lonvick
 *
 * `<NNN>` priority byte is optional (RFC 3164 strictly requires it,
 * but a huge chunk of legacy daemons drop it). Captures it when
 * present and derives `severity` (= priority % 8) for level mapping.
 *
 * `program[pid]:` form is the standard; we treat `[pid]` as optional
 * since some daemons omit it.
 */
export const syslog3164Parser = defineRegexParser({
  id: 'syslog-3164',
  pattern:
    /^(?:<(\d+)>)?(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+([^:[\s]+)(?:\[(\d+)\])?:\s*(.*)$/,
  fields: [
    { group: 1, name: 'priority', transform: 'number' },
    { group: 3, name: 'hostname' },
    { group: 4, name: 'program' },
    { group: 5, name: 'pid', transform: 'number' },
    { group: 6, name: 'syslog_message' },
  ],
  timestampGroup: 2,
  timestampTransform: 'syslog-time',
  // Default to 'info' when no priority byte is present; the regex
  // parser's level strategies are static, so we accept that lossy
  // case rather than wire a per-row fallback here. Future hook for
  // 'fallback' kind in `LevelStrategy` would clean this up.
  level: { kind: 'syslog-severity', group: 1 },
  message: (g) => g[6] ?? '',
  confidence: 0.85,
  defaultColumns: ['program', 'hostname'],
});
