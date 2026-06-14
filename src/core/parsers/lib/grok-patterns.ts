/**
 * Built-in grok-pattern library (Phase 2.C.grok). A pared-down version
 * of logstash-patterns-core covering the tokens we need for the
 * reference parsers (Apache/nginx/syslog) and the most common
 * application-log shapes. Users can extend the set per-definition via
 * `CustomParserDef.customTokens`.
 *
 * The values here are *regex sources* — no anchoring, no flags. Tokens
 * MUST stay free of capturing groups so that nested expansion doesn't
 * shift the index of user-named outer captures.
 */
export const BUILTIN_GROK_PATTERNS: Readonly<Record<string, string>> = {
  // Generic primitives
  WORD: '\\w+',
  NOTSPACE: '\\S+',
  SPACE: '\\s*',
  DATA: '.*?',
  GREEDYDATA: '.*',
  QUOTEDSTRING: '"(?:[^"\\\\]|\\\\.)*"',
  UUID: '[A-Fa-f0-9]{8}-(?:[A-Fa-f0-9]{4}-){3}[A-Fa-f0-9]{12}',
  MAC: '(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}',

  // Numbers
  INT: '-?\\d+',
  LONG: '-?\\d+',
  NUMBER: '-?\\d+(?:\\.\\d+)?',
  FLOAT: '-?\\d+(?:\\.\\d+)?',
  POSINT: '[1-9]\\d*',
  NONNEGINT: '\\d+',
  BASE10NUM: '-?(?:\\d+(?:\\.\\d+)?|\\.\\d+)',
  BASE16NUM: '(?:0[xX])?[0-9A-Fa-f]+',

  // Net
  IPV4: '(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)(?:\\.(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)){3}',
  IPV6: '(?:[A-Fa-f0-9]{0,4}:){2,7}[A-Fa-f0-9]{0,4}',
  IP: '(?:%{IPV6}|%{IPV4})',
  HOSTNAME: '(?:[0-9A-Za-z][0-9A-Za-z-]*)(?:\\.(?:[0-9A-Za-z][0-9A-Za-z-]*))*',
  IPORHOST: '(?:%{IP}|%{HOSTNAME})',
  HOSTPORT: '%{IPORHOST}:%{POSINT}',

  // URI
  URIPROTO: '[A-Za-z]+(?:\\+[A-Za-z+]+)?',
  URIHOST: '%{IPORHOST}(?::%{POSINT})?',
  URIPATH: "(?:/[A-Za-z0-9$.+!*'(){},~:;=@#%&_\\-]*)+",
  URIPARAM: "\\?[A-Za-z0-9$.+!*|'(){},~@#%&/=:;_?\\-\\[\\]<>]*",
  URIPATHPARAM: '%{URIPATH}(?:\\?[^\\s]*)?',
  URI: '%{URIPROTO}://(?:%{USER}(?::[^@]*)?@)?(?:%{URIHOST})?(?:%{URIPATHPARAM})?',

  // Users
  USER: '[a-zA-Z0-9._-]+',
  USERNAME: '[a-zA-Z0-9._-]+',
  EMAILLOCALPART: "[a-zA-Z0-9!#$%&'*+\\-/=?^_`{|}~]+",
  EMAILADDRESS: '%{EMAILLOCALPART}@%{HOSTNAME}',

  // Dates / times
  MONTH:
    '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)',
  MONTHNUM: '(?:0?[1-9]|1[0-2])',
  MONTHDAY: '(?:[0-3]?[0-9])',
  DAY: '(?:Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)',
  YEAR: '\\d{2,4}',
  HOUR: '(?:[0-1]?[0-9]|2[0-3])',
  MINUTE: '[0-5]?[0-9]',
  SECOND: '(?:[0-5]?[0-9])(?:\\.\\d+)?',
  TIME: '%{HOUR}:%{MINUTE}:%{SECOND}',
  DATE_US: '%{MONTHNUM}[/-]%{MONTHDAY}[/-]%{YEAR}',
  DATE_EU: '%{MONTHDAY}[./-]%{MONTHNUM}[./-]%{YEAR}',
  DATESTAMP: '%{DATE_US}\\s+%{TIME}|%{DATE_EU}\\s+%{TIME}',
  TIMESTAMP_ISO8601:
    '\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:?\\d{2})?',
  HTTPDATE: '%{MONTHDAY}/%{MONTH}/%{YEAR}:%{TIME}\\s+[+-]\\d{4}',
  SYSLOGTIMESTAMP: '%{MONTH}\\s+%{MONTHDAY}\\s+%{TIME}',

  // App-log
  LOGLEVEL:
    '(?:[Aa][Ll][Ee][Rr][Tt]|[Tt][Rr][Aa][Cc][Ee]|[Dd][Ee][Bb][Uu][Gg]|[Nn][Oo][Tt][Ii][Cc][Ee]|[Ii][Nn][Ff][Oo](?:[Rr][Mm][Aa][Tt][Ii][Oo][Nn])?|[Ww][Aa][Rr][Nn](?:[Ii][Nn][Gg])?|[Ee][Rr][Rr](?:[Oo][Rr])?|[Cc][Rr][Ii][Tt](?:[Ii][Cc][Aa][Ll])?|[Ff][Aa][Tt][Aa][Ll]|[Ss][Ee][Vv][Ee][Rr][Ee]|[Ee][Mm][Ee][Rr][Gg](?:[Ee][Nn][Cc][Yy])?)',
};

/**
 * Approximate transform hint for a grok token name. Used when the user
 * adds `%{NUMBER:bytes}` without an explicit `:int` type — we default
 * to `number` so the field arrives as a numeric value rather than a
 * string. The map is purposely small: only tokens where the typed
 * interpretation is unambiguous.
 */
export const TOKEN_DEFAULT_TYPE: Readonly<
  Record<string, 'int' | 'long' | 'float' | 'number'>
> = {
  INT: 'int',
  LONG: 'long',
  NUMBER: 'number',
  FLOAT: 'float',
  POSINT: 'int',
  NONNEGINT: 'int',
  BASE10NUM: 'number',
  BASE16NUM: 'int',
};
