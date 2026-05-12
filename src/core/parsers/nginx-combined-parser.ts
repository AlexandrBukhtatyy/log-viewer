import { defineRegexParser } from './lib/regex-parser.ts';

/**
 * Nginx combined log format (also Apache's `combined`):
 *
 *   $remote_addr - $remote_user [$time_local] "$method $uri HTTP/$ver"
 *     $status $bytes_sent "$http_referer" "$http_user_agent"
 *
 * Example:
 *   28.178.205.112 - - [05/May/2026:06:00:00 +0000]
 *     "PUT /api/v1/auth/login HTTP/1.1" 401 23017 "-" "curl/8.4.0"
 *
 * `canParse` is the regex `test` itself — cheap enough to keep the
 * registry pick fast even with several parsers ahead of plain text.
 */
export const nginxCombinedParser = defineRegexParser({
  id: 'nginx-combined',
  pattern:
    /^(\S+) (\S+) (\S+) \[([^\]]+)\] "(\S+) (\S+) HTTP\/(\S+)" (\d+) (\d+|-) "([^"]*)" "([^"]*)"\s*$/,
  fields: [
    { group: 1, name: 'remote_addr' },
    { group: 3, name: 'remote_user' },
    { group: 5, name: 'method' },
    { group: 6, name: 'request_uri' },
    { group: 7, name: 'http_version' },
    { group: 8, name: 'status', transform: 'number' },
    { group: 9, name: 'bytes_sent', transform: 'number' },
    { group: 10, name: 'referer' },
    { group: 11, name: 'user_agent' },
  ],
  timestampGroup: 4,
  timestampTransform: 'apache-time',
  level: { kind: 'http-status', group: 8 },
  message: (g) => `${g[5]} ${g[6]} → ${g[8]}`,
  confidence: 0.95,
  defaultColumns: ['method', 'status', 'request_uri'],
});
