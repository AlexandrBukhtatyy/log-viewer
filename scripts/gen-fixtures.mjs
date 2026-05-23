#!/usr/bin/env node
// Генерация локальных лог-фикстур разных форматов в .tmp/.
// Детерминировано (фиксированный seed) и без внешних зависимостей.
// Запуск: pnpm gen:fixtures

import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, '.tmp');

mkdirSync(OUT_DIR, { recursive: true });

// Простой LCG (Numerical Recipes). Один сид -> один и тот же набор фикстур.
const makeRng = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
};

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const weighted = (rng, pairs) => {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let t = rng() * total;
  for (const [v, w] of pairs) {
    t -= w;
    if (t <= 0) return v;
  }
  return pairs[pairs.length - 1][0];
};

const SERVICES = ['api-gateway', 'auth', 'billing', 'orders', 'shipping', 'search', 'notifications'];
const HOSTS = ['app-01', 'app-02', 'app-03', 'worker-01', 'worker-02'];
const USERS = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank'];
const ROUTES = [
  '/api/v1/users',
  '/api/v1/orders',
  '/api/v1/orders/42/items',
  '/api/v1/search?q=laptop',
  '/api/v1/auth/login',
  '/api/v1/checkout',
  '/healthz',
  '/metrics',
];
const METHODS = ['GET', 'POST', 'PUT', 'DELETE'];
const STATUSES = [200, 200, 200, 200, 201, 204, 301, 304, 400, 401, 403, 404, 500, 502, 503];
const UAS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'curl/8.4.0',
  'Go-http-client/1.1',
  'kube-probe/1.29',
];
const MESSAGES_INFO = [
  'request handled',
  'cache hit',
  'connection established',
  'job scheduled',
  'user logged in',
  'token refreshed',
  'metric flushed',
];
const MESSAGES_WARN = [
  'slow query detected',
  'retry attempt scheduled',
  'cache miss for hot key',
  'rate limit approaching',
  'deprecated endpoint hit',
];
const MESSAGES_ERROR = [
  'database connection refused',
  'upstream timeout',
  'failed to enqueue job',
  'invalid signature',
  'panic recovered',
];

const padStart = (n, width, ch = '0') => String(n).padStart(width, ch);

const fmtIso = (ts) => new Date(ts).toISOString();

// Apache common log time: 02/May/2026:14:23:11 +0000
const fmtClf = (ts) => {
  const d = new Date(ts);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return (
    `${padStart(d.getUTCDate(), 2)}/${months[d.getUTCMonth()]}/${d.getUTCFullYear()}:` +
    `${padStart(d.getUTCHours(), 2)}:${padStart(d.getUTCMinutes(), 2)}:${padStart(d.getUTCSeconds(), 2)} +0000`
  );
};

const randomIp = (rng) =>
  `${10 + Math.floor(rng() * 240)}.${Math.floor(rng() * 256)}.${Math.floor(rng() * 256)}.${Math.floor(rng() * 256)}`;

const writeFile = (name, body) => {
  const p = resolve(OUT_DIR, name);
  writeFileSync(p, body);
  const size = statSync(p).size;
  return { name, path: p, size };
};

const fmtSize = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// ---------- Generators ----------

// 1. Pino-style JSON Lines: { level: 30, time: <ms>, msg, ... }
const genPino = (lines, seed) => {
  const rng = makeRng(seed);
  const start = Date.UTC(2026, 4, 1, 9, 0, 0); // 2026-05-01 09:00 UTC
  const out = [];
  for (let i = 0; i < lines; i++) {
    const ts = start + i * (1000 + Math.floor(rng() * 4000));
    const level = weighted(rng, [
      [10, 1],   // trace
      [20, 6],   // debug
      [30, 60],  // info
      [40, 12],  // warn
      [50, 4],   // error
      [60, 0.2], // fatal
    ]);
    const msg =
      level >= 50 ? pick(rng, MESSAGES_ERROR) : level >= 40 ? pick(rng, MESSAGES_WARN) : pick(rng, MESSAGES_INFO);
    const obj = {
      level,
      time: ts,
      pid: 4321,
      hostname: pick(rng, HOSTS),
      service: pick(rng, SERVICES),
      reqId: `req_${padStart(i, 6)}`,
      userId: rng() < 0.7 ? pick(rng, USERS) : undefined,
      latencyMs: Math.floor(rng() * 800),
      msg,
    };
    if (level >= 50) {
      obj.err = {
        type: pick(rng, ['ConnectionError', 'TimeoutError', 'ValidationError', 'AuthError']),
        code: pick(rng, ['ECONNREFUSED', 'ETIMEDOUT', 'EAUTH', 'EBADREQ']),
      };
    }
    // Срезаем undefined.
    for (const k of Object.keys(obj)) if (obj[k] === undefined) delete obj[k];
    out.push(JSON.stringify(obj));
  }
  return out.join('\n') + '\n';
};

// 2. Bunyan/Elastic-style JSON Lines: ISO @timestamp, level: "INFO" и т.п.
const genBunyan = (lines, seed) => {
  const rng = makeRng(seed);
  const start = Date.UTC(2026, 4, 2, 12, 0, 0);
  const levels = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
  const out = [];
  for (let i = 0; i < lines; i++) {
    const ts = start + i * (500 + Math.floor(rng() * 6000));
    const lvl = weighted(rng, [
      ['DEBUG', 5],
      ['INFO', 70],
      ['WARN', 20],
      ['ERROR', 5],
    ]);
    const obj = {
      '@timestamp': fmtIso(ts),
      level: lvl,
      logger: `com.acme.${pick(rng, SERVICES)}.${pick(rng, ['Controller', 'Service', 'Repository'])}`,
      thread: `pool-${1 + Math.floor(rng() * 8)}-thread-${1 + Math.floor(rng() * 4)}`,
      message:
        lvl === 'ERROR' ? pick(rng, MESSAGES_ERROR) : lvl === 'WARN' ? pick(rng, MESSAGES_WARN) : pick(rng, MESSAGES_INFO),
      traceId: `${padStart(Math.floor(rng() * 0xffffffff).toString(16), 8)}${padStart(
        Math.floor(rng() * 0xffffffff).toString(16),
        8,
      )}`,
      spanId: padStart(Math.floor(rng() * 0xffffffff).toString(16), 8),
      tenantId: `t_${1000 + Math.floor(rng() * 50)}`,
    };
    void levels;
    out.push(JSON.stringify(obj));
  }
  return out.join('\n') + '\n';
};

// 3. Plain-text app log: [ISO] LEVEL [service] message k=v k=v
const genPlainApp = (lines, seed) => {
  const rng = makeRng(seed);
  const start = Date.UTC(2026, 4, 3, 8, 30, 0);
  const out = [];
  for (let i = 0; i < lines; i++) {
    const ts = start + i * (200 + Math.floor(rng() * 3000));
    const lvl = weighted(rng, [
      ['TRACE', 2],
      ['DEBUG', 8],
      ['INFO', 60],
      ['WARN', 20],
      ['ERROR', 9],
      ['FATAL', 1],
    ]);
    const svc = pick(rng, SERVICES);
    const msg = lvl === 'ERROR' || lvl === 'FATAL'
      ? pick(rng, MESSAGES_ERROR)
      : lvl === 'WARN'
        ? pick(rng, MESSAGES_WARN)
        : pick(rng, MESSAGES_INFO);
    out.push(
      `[${fmtIso(ts)}] ${lvl.padEnd(5)} [${svc}] ${msg} reqId=req_${padStart(i, 6)} latency=${Math.floor(rng() * 1000)}ms`,
    );
  }
  return out.join('\n') + '\n';
};

// 4. Mixed: plain text вперемешку с JSON-объектами.
const genMixed = (lines, seed) => {
  const rng = makeRng(seed);
  const start = Date.UTC(2026, 4, 4, 10, 0, 0);
  const out = [];
  for (let i = 0; i < lines; i++) {
    const ts = start + i * (1000 + Math.floor(rng() * 5000));
    if (rng() < 0.45) {
      out.push(
        JSON.stringify({
          ts,
          level: pick(rng, ['info', 'warn', 'error']),
          msg: pick(rng, MESSAGES_INFO),
          host: pick(rng, HOSTS),
        }),
      );
    } else {
      out.push(`${fmtIso(ts)} INFO  ${pick(rng, SERVICES)}: ${pick(rng, MESSAGES_INFO)}`);
    }
  }
  return out.join('\n') + '\n';
};

// 5. Nginx access log (combined).
const genNginxAccess = (lines, seed) => {
  const rng = makeRng(seed);
  const start = Date.UTC(2026, 4, 5, 6, 0, 0);
  const out = [];
  for (let i = 0; i < lines; i++) {
    const ts = start + i * (50 + Math.floor(rng() * 2500));
    const ip = randomIp(rng);
    const method = pick(rng, METHODS);
    const route = pick(rng, ROUTES);
    const status = pick(rng, STATUSES);
    const bytes = 80 + Math.floor(rng() * 40000);
    const ua = pick(rng, UAS);
    out.push(`${ip} - - [${fmtClf(ts)}] "${method} ${route} HTTP/1.1" ${status} ${bytes} "-" "${ua}"`);
  }
  return out.join('\n') + '\n';
};

// 6. Stack traces — multi-line Java и Python, перемешанные с обычными сообщениями.
const genStackTraces = (events, seed) => {
  const rng = makeRng(seed);
  const start = Date.UTC(2026, 4, 6, 14, 0, 0);
  const out = [];
  for (let i = 0; i < events; i++) {
    const ts = start + i * (3000 + Math.floor(rng() * 7000));
    const lvl = weighted(rng, [
      ['INFO', 50],
      ['WARN', 25],
      ['ERROR', 25],
    ]);
    out.push(`[${fmtIso(ts)}] ${lvl.padEnd(5)} request ${i} from ${pick(rng, USERS)}`);
    if (lvl === 'ERROR') {
      if (rng() < 0.5) {
        // Java-стиль
        out.push(`[${fmtIso(ts + 1)}] ERROR java.lang.RuntimeException: Failed to process request ${i}`);
        out.push(`\tat com.acme.${pick(rng, SERVICES)}.handler.RequestHandler.handle(RequestHandler.java:${50 + Math.floor(rng() * 200)})`);
        out.push(`\tat com.acme.framework.dispatch.Dispatcher.dispatch(Dispatcher.java:${100 + Math.floor(rng() * 100)})`);
        out.push(`\tat io.netty.channel.AbstractChannelHandlerContext.invokeChannelRead(AbstractChannelHandlerContext.java:379)`);
        out.push(`Caused by: java.sql.SQLException: Connection refused`);
        out.push(`\tat org.postgresql.Driver.connect(Driver.java:280)`);
        out.push(`\t... ${3 + Math.floor(rng() * 8)} more`);
      } else {
        // Python-стиль
        out.push(`[${fmtIso(ts + 1)}] ERROR Traceback (most recent call last):`);
        out.push(`  File "/app/handlers.py", line ${50 + Math.floor(rng() * 200)}, in handle_request`);
        out.push(`    result = process(payload)`);
        out.push(`  File "/app/processor.py", line ${10 + Math.floor(rng() * 100)}, in process`);
        out.push(`    return db.execute(query)`);
        out.push(`  File "/app/db.py", line 88, in execute`);
        out.push(`    raise ConnectionError("upstream timeout")`);
        out.push(`ConnectionError: upstream timeout`);
      }
    }
  }
  return out.join('\n') + '\n';
};

// 7. Каталог `mixed/` — три файла с **общим** timeline'ом, записи раскиданы
//    round-robin между ними. Используется для проверки, что при выборе
//    нескольких файлов в сайдбаре combined-выдача показывает записи строго
//    в хронологическом порядке (timestamp-interleaving) — не блоками по
//    файлам и не вперемешку seq'ами.
//
// Форматы выбраны так, чтобы все три парсились с извлекаемым timestamp'ом:
//   - events.jsonl  — pino-стиль JSONL (числовой `time` в ms, числовые `level`)
//   - system.log    — `[ISO] LEVEL  service: message k=v` (app-text парсер)
//   - audit.txt     — тот же [ISO]-формат, но audit-доменные сообщения
//
// XML/MXL не делаем: парсера под XML нет, а `.xml` не входит в
// DEFAULT_FILE_EXT_RE (см. core/sources/walk-directory.ts), поэтому такой
// файл всё равно не проиндексировался бы как лог.
const genMixedDir = (totalLines, seed) => {
  const rng = makeRng(seed);
  const start = Date.UTC(2026, 4, 15, 9, 0, 0); // 2026-05-15 09:00 UTC
  // Растягиваем общую длительность так, чтобы соседние записи в одном файле
  // отстояли друг от друга на ~единицы секунд — это делает интерливинг
  // визуально очевидным в выдаче, без накладок секунда-в-секунду.
  const stepMs = () => 800 + Math.floor(rng() * 2200);

  const jsonl = [];
  const app = [];
  const audit = [];

  const AUDIT_MSGS = [
    'user logged in',
    'user logged out',
    'permission granted',
    'permission revoked',
    'api key rotated',
    'password changed',
    'mfa enabled',
    'mfa disabled',
    'role assigned',
    'role removed',
  ];

  let ts = start;
  for (let i = 0; i < totalLines; i++) {
    ts += stepMs();
    // Round-robin между тремя файлами + лёгкий jitter, чтобы не превращалось
    // в строгое чередование «1-2-3-1-2-3». Видеть переплетение интереснее,
    // когда подряд иногда идут две записи в один файл.
    const bucket = weighted(rng, [
      [0, 1], // jsonl
      [1, 1], // log
      [2, 1], // txt
    ]);

    if (bucket === 0) {
      const level = weighted(rng, [
        [20, 5],
        [30, 65],
        [40, 22],
        [50, 8],
      ]);
      const msg =
        level >= 50 ? pick(rng, MESSAGES_ERROR) : level >= 40 ? pick(rng, MESSAGES_WARN) : pick(rng, MESSAGES_INFO);
      jsonl.push(
        JSON.stringify({
          level,
          time: ts,
          service: pick(rng, SERVICES),
          host: pick(rng, HOSTS),
          reqId: `req_${padStart(i, 6)}`,
          msg,
          latencyMs: Math.floor(rng() * 600),
        }),
      );
    } else if (bucket === 1) {
      const lvl = weighted(rng, [
        ['DEBUG', 8],
        ['INFO', 65],
        ['WARN', 20],
        ['ERROR', 7],
      ]);
      const svc = pick(rng, SERVICES);
      const msg = lvl === 'ERROR'
        ? pick(rng, MESSAGES_ERROR)
        : lvl === 'WARN'
          ? pick(rng, MESSAGES_WARN)
          : pick(rng, MESSAGES_INFO);
      app.push(
        `[${fmtIso(ts)}] ${lvl.padEnd(5)} [${svc}] ${msg} reqId=req_${padStart(i, 6)} latency=${Math.floor(rng() * 800)}ms`,
      );
    } else {
      const lvl = weighted(rng, [
        ['INFO', 80],
        ['WARN', 15],
        ['ERROR', 5],
      ]);
      const actor = pick(rng, USERS);
      const msg = pick(rng, AUDIT_MSGS);
      audit.push(
        `[${fmtIso(ts)}] ${lvl.padEnd(5)} [audit] ${msg} actor=${actor} ip=${randomIp(rng)}`,
      );
    }
  }

  return {
    'events.jsonl': jsonl.join('\n') + '\n',
    'system.log': app.join('\n') + '\n',
    'audit.txt': audit.join('\n') + '\n',
  };
};

// 8. Большой JSON Lines файл (для нагрузочных проверок: virtual scroll, индексация).
const genLargeJsonl = (lines, seed) => {
  const rng = makeRng(seed);
  const start = Date.UTC(2026, 3, 1, 0, 0, 0); // месяц данных
  const chunks = [];
  for (let i = 0; i < lines; i++) {
    const ts = start + i * (50 + Math.floor(rng() * 200));
    const level = weighted(rng, [
      [20, 5],
      [30, 70],
      [40, 18],
      [50, 7],
    ]);
    chunks.push(
      JSON.stringify({
        level,
        time: ts,
        service: pick(rng, SERVICES),
        host: pick(rng, HOSTS),
        reqId: `req_${padStart(i, 7)}`,
        msg: level >= 50 ? pick(rng, MESSAGES_ERROR) : level >= 40 ? pick(rng, MESSAGES_WARN) : pick(rng, MESSAGES_INFO),
        latencyMs: Math.floor(rng() * 1500),
      }),
    );
    chunks.push('\n');
  }
  return chunks.join('');
};

// ---------- Run ----------

const fixtures = [
  { file: 'pino.jsonl',        gen: () => genPino(800, 0xC0FFEE) },
  { file: 'bunyan.jsonl',      gen: () => genBunyan(600, 0xBADCAFE) },
  { file: 'app.log',           gen: () => genPlainApp(700, 0xFEEDFACE) },
  { file: 'mixed.log',         gen: () => genMixed(400, 0xDEADBEEF) },
  { file: 'nginx-access.log',  gen: () => genNginxAccess(1000, 0xABCDEF01) },
  { file: 'stack-traces.log',  gen: () => genStackTraces(120, 0x1234ABCD) },
  { file: 'large.jsonl',       gen: () => genLargeJsonl(50_000, 0x7E57DA7A) },
];

console.log(`Writing fixtures into ${OUT_DIR}`);
const results = [];
for (const { file, gen } of fixtures) {
  const body = gen();
  results.push(writeFile(file, body));
}

// `demo_logs/mixed/` — общая папка с тремя разными форматами и **сквозным**
// timeline'ом, чтобы тестировать выбор нескольких файлов в сайдбаре и
// убеждаться, что combined-выдача переплетает записи по timestamp'у, а не
// показывает блоками по файлам. Каждый файл получает свою долю записей в
// своём же хронологическом порядке.
const mixedDir = resolve(OUT_DIR, 'demo_logs', 'mixed');
mkdirSync(mixedDir, { recursive: true });
const mixedFiles = genMixedDir(900, 0x5EEDED5);
for (const [name, body] of Object.entries(mixedFiles)) {
  const p = resolve(mixedDir, name);
  writeFileSync(p, body);
  results.push({ name: `demo_logs/mixed/${name}`, path: p, size: statSync(p).size });
}

const namePad = Math.max(...results.map((r) => r.name.length));
for (const r of results) {
  console.log(`  ${r.name.padEnd(namePad)}  ${fmtSize(r.size)}`);
}
console.log(`\nDone. ${results.length} files, total ${fmtSize(results.reduce((s, r) => s + r.size, 0))}.`);
