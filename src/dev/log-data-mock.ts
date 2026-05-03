// Mock catalog of log sources and entries — dev-only fixture used by lv-preview.tsx.
// Ported from the original src/ui/log-data.js IIFE; do NOT import from src/ui or src/app.

import type {
  LvCatalogRoot,
  LvFileNode,
  LvFolderNode,
  LvLogEntry,
  LvLogKind,
  LvLogLevel,
  LvNode,
  LvSavedSearch,
} from '../ui/contracts/lv-types.ts';

const LEVELS: LvLogLevel[] = ['error', 'warn', 'info', 'debug', 'trace'];
const SERVICES = [
  'api-gateway',
  'auth-service',
  'billing',
  'checkout',
  'worker-queue',
  'ingest',
  'scheduler',
];
const USERS = ['u_8213', 'u_4419', 'u_9702', 'u_1155', 'u_3378', 'u_6620'];
const PATHS = [
  '/v1/auth/login',
  '/v1/users/me',
  '/v1/checkout/session',
  '/v1/orders',
  '/v1/webhooks/stripe',
  '/healthz',
  '/metrics',
  '/v1/invoices/latest',
];
const IPS = [
  '10.4.1.8',
  '10.4.1.9',
  '10.4.2.11',
  '172.19.0.4',
  '192.168.1.44',
  '34.221.19.5',
];
const METHODS = ['GET', 'POST', 'PUT', 'DELETE'];
const MESSAGES: Record<LvLogLevel, string[]> = {
  error: [
    'Unhandled exception in request handler',
    'Database connection refused: dial tcp 10.4.1.22:5432',
    'Timeout waiting for upstream response',
    'Payment gateway returned HTTP 502',
    'Redis cluster lost quorum; failing over',
    'Cannot acquire write lock on partition 17',
    'Invalid JWT signature — token rejected',
  ],
  warn: [
    'Slow query detected (1482ms) on orders_by_user',
    'Deprecated API endpoint /v0/users used',
    'Retrying request after 503 (attempt 3/5)',
    'Queue depth above threshold: 2041 messages',
    'Rate limit approaching for client f7a2',
    'TLS certificate expires in 14 days',
  ],
  info: [
    'Request completed',
    'Worker picked up job',
    'Cache warmed',
    'Scheduled task finished',
    'Config reloaded from source',
    'User signed in',
    'Sent email via provider',
  ],
  debug: [
    'Resolved feature flag checkout_v2=true for user',
    'Serialized payload size=4821b',
    'Span started',
    'Opened pooled connection #14',
    'Memoization hit for key calc:tax:ON',
  ],
  trace: [
    'entering function handleOrder',
    'exit function handleOrder dur=12ms',
    'span.attribute db.system=postgresql',
  ],
};

function weightedLevel(i: number): LvLogLevel {
  const r = (Math.sin(i * 12.9898) * 43758.5453) % 1;
  const v = Math.abs(r);
  if (v < 0.03) return 'error';
  if (v < 0.1) return 'warn';
  if (v < 0.55) return 'info';
  if (v < 0.92) return 'debug';
  return 'trace';
}

let seed = 1;
function srand(): number {
  seed = (seed * 9301 + 49297) % 233280;
  return seed / 233280;
}
function spick<T>(arr: T[]): T {
  return arr[Math.floor(srand() * arr.length)]!;
}

interface TraceSlot {
  trace_id: string;
  req_id: string;
  user_id: string;
}

const TRACE_POOL: TraceSlot[] = [];
for (let i = 0; i < 24; i++) {
  TRACE_POOL.push({
    trace_id: Math.floor(Math.sin(i * 2.17) * 1e16 + 1e16)
      .toString(16)
      .padStart(16, '0')
      .slice(0, 16),
    req_id: 'req_' + (i * 7919 + 1234).toString(36),
    user_id: USERS[i % USERS.length]!,
  });
}

function pickTrace(seedVal: number): TraceSlot | null {
  const r = Math.abs(Math.sin(seedVal * 1.7) * 100) % 1;
  if (r < 0.65)
    return TRACE_POOL[
      Math.floor(Math.abs(Math.cos(seedVal)) * TRACE_POOL.length) % TRACE_POOL.length
    ]!;
  return null;
}

type Generator = (id: number, baseTs: number, file: LvFileNode, service: string) => LvLogEntry;

const genAppLog: Generator = (id, baseTs, file, service) => {
  seed = id * 7 + 3;
  const level = weightedLevel(id);
  const ts = new Date(baseTs + id * 1700 + Math.floor(srand() * 1500));
  const msg = spick(MESSAGES[level]);
  const traceShared = pickTrace(id * 7 + file.id.length);
  const reqId = traceShared?.req_id || 'req_' + Math.floor(srand() * 1e9).toString(36);
  const userId = traceShared?.user_id || spick(USERS);
  const traceId =
    traceShared?.trace_id ||
    Math.floor(srand() * 1e16)
      .toString(16)
      .padStart(16, '0');
  const dur = Math.floor(srand() * 1600) + 4;
  const path = spick(PATHS);
  const method = spick(METHODS);
  const fields = {
    service,
    trace_id: traceId,
    req_id: reqId,
    user_id: userId,
    path,
    method,
    status: level === 'error' ? 500 : level === 'warn' ? 429 : 200,
    duration_ms: dur,
  };
  const raw = `${ts.toISOString()} ${level.toUpperCase().padEnd(5)} [${service}] ${msg} trace_id=${traceId} req_id=${reqId} user=${userId} path=${method} ${path} status=${fields.status} dur=${dur}ms`;
  return {
    id: `${file.id}:${id}`,
    fileId: file.id,
    file: file.name,
    path: file.path ?? '',
    line: id + 1,
    ts: ts.toISOString(),
    level,
    service,
    msg,
    fields,
    raw,
    kind: 'app',
  };
};

const genJsonLog: Generator = (id, baseTs, file, service) => {
  seed = id * 11 + 5;
  const level = weightedLevel(id);
  const ts = new Date(baseTs + id * 1300 + Math.floor(srand() * 1000));
  const msg = spick(MESSAGES[level]);
  const traceShared = pickTrace(id * 11 + file.id.length * 3);
  const traceId =
    traceShared?.trace_id ||
    Math.floor(srand() * 1e16)
      .toString(16)
      .padStart(16, '0');
  const spanId = Math.floor(srand() * 1e10)
    .toString(16)
    .padStart(8, '0');
  const userId = traceShared?.user_id || spick(USERS);
  const reqId = traceShared?.req_id || 'req_' + Math.floor(srand() * 1e9).toString(36);
  const status = level === 'error' ? 500 : level === 'warn' ? 429 : 200;
  const dur = Math.floor(srand() * 1200) + 3;
  const fields = {
    ts: ts.toISOString(),
    level,
    service,
    msg,
    trace_id: traceId,
    span_id: spanId,
    req_id: reqId,
    user_id: userId,
    status,
    duration_ms: dur,
  };
  return {
    id: `${file.id}:${id}`,
    fileId: file.id,
    file: file.name,
    path: file.path ?? '',
    line: id + 1,
    ts: ts.toISOString(),
    level,
    service,
    msg,
    fields,
    raw: JSON.stringify(fields),
    kind: 'json',
  };
};

const genNginx: Generator = (id, baseTs, file) => {
  seed = id * 5 + 9;
  const ts = new Date(baseTs + id * 900 + Math.floor(srand() * 700));
  const ip = spick(IPS);
  const method = spick(METHODS);
  const path = spick(PATHS);
  const status = [200, 200, 200, 200, 301, 304, 400, 404, 500][Math.floor(srand() * 9)]!;
  const size = Math.floor(srand() * 8400) + 120;
  const dur = Math.floor(srand() * 900) + 3;
  const level: LvLogLevel = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
  const ua = 'Mozilla/5.0';
  const raw = `${ip} - - [${ts.toUTCString()}] "${method} ${path} HTTP/1.1" ${status} ${size} "-" "${ua}" ${dur}ms`;
  return {
    id: `${file.id}:${id}`,
    fileId: file.id,
    file: file.name,
    path: file.path ?? '',
    line: id + 1,
    ts: ts.toISOString(),
    level,
    service: 'nginx',
    msg: `${method} ${path} → ${status}`,
    fields: { remote_addr: ip, method, path, status, bytes: size, duration_ms: dur },
    raw,
    kind: 'nginx',
  };
};

const genK8s: Generator = (id, baseTs, file) => {
  seed = id * 13 + 17;
  const ts = new Date(baseTs + id * 1100 + Math.floor(srand() * 800));
  const level = weightedLevel(id);
  const pod = `${spick(SERVICES)}-${Math.floor(srand() * 9000 + 1000)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
  const container = pod.split('-').slice(0, -2).join('-');
  const msg = spick(MESSAGES[level]);
  const fields = {
    pod,
    container,
    namespace: 'prod',
    node: `ip-10-0-${Math.floor(srand() * 200)}`,
  };
  const raw = `${ts.toISOString()} ${pod} ${container} ${level.toUpperCase()} ${msg}`;
  return {
    id: `${file.id}:${id}`,
    fileId: file.id,
    file: file.name,
    path: file.path ?? '',
    line: id + 1,
    ts: ts.toISOString(),
    level,
    service: container,
    msg,
    fields,
    raw,
    kind: 'k8s',
  };
};

const genSyslog: Generator = (id, baseTs, file) => {
  seed = id * 19 + 23;
  const ts = new Date(baseTs + id * 2000 + Math.floor(srand() * 1500));
  const level = weightedLevel(id);
  const host = 'web-prod-01';
  const proc = ['sshd', 'kernel', 'systemd', 'cron', 'dockerd'][Math.floor(srand() * 5)]!;
  const pid = Math.floor(srand() * 9000 + 1000);
  const msg = spick(MESSAGES[level]);
  const raw = `${ts.toUTCString().slice(5, 22)} ${host} ${proc}[${pid}]: ${msg}`;
  return {
    id: `${file.id}:${id}`,
    fileId: file.id,
    file: file.name,
    path: file.path ?? '',
    line: id + 1,
    ts: ts.toISOString(),
    level,
    service: proc,
    msg,
    fields: { host, process: proc, pid },
    raw,
    kind: 'syslog',
  };
};

const genStackTrace: Generator = (id, baseTs, file) => {
  seed = id * 29 + 11;
  const ts = new Date(baseTs + id * 4000 + Math.floor(srand() * 2000));
  const types = [
    {
      name: 'NullPointerException',
      lang: 'java',
      stack: [
        'java.lang.NullPointerException: Cannot invoke "User.getEmail()" because "user" is null',
        '    at com.acme.billing.InvoiceService.send(InvoiceService.java:142)',
        '    at com.acme.billing.BillingWorker.run(BillingWorker.java:68)',
        '    at java.base/java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1136)',
        '    at java.base/java.lang.Thread.run(Thread.java:833)',
      ],
    },
    {
      name: 'TypeError',
      lang: 'node',
      stack: [
        "TypeError: Cannot read properties of undefined (reading 'id')",
        '    at handleOrder (/app/src/orders/handler.ts:57:22)',
        '    at process.processTicksAndRejections (node:internal/process/task_queues:96:5)',
        '    at async Worker.consume (/app/src/queue/worker.ts:33:5)',
      ],
    },
    {
      name: 'psycopg2.OperationalError',
      lang: 'python',
      stack: [
        'Traceback (most recent call last):',
        '  File "/srv/app/ingest/pipeline.py", line 214, in run',
        '    self.session.execute(stmt)',
        '  File "/usr/lib/python3.11/site-packages/sqlalchemy/orm/session.py", line 1717, in execute',
        '    return self._execute_internal(statement, params)',
        'psycopg2.OperationalError: server closed the connection unexpectedly',
      ],
    },
  ];
  const t = types[Math.floor(srand() * types.length)]!;
  const service = spick(SERVICES);
  return {
    id: `${file.id}:${id}`,
    fileId: file.id,
    file: file.name,
    path: file.path ?? '',
    line: id + 1,
    ts: ts.toISOString(),
    level: 'error',
    service,
    msg: t.stack[0]!,
    fields: { service, exception: t.name, lang: t.lang },
    stack: t.stack,
    raw: t.stack.join('\n'),
    kind: 'stacktrace',
  };
};

const BASE_TS = new Date('2026-04-23T09:14:02Z').getTime();

export const CATALOG: LvCatalogRoot[] = [
  {
    id: 'root',
    name: '/var/log',
    path: '/var/log',
    type: 'folder',
    root: true,
    source: 'local-static',
    open: true,
    children: [
      {
        id: 'app',
        name: 'app',
        type: 'folder',
        open: true,
        children: [
          { id: 'api-2026-04-23', name: 'api-gateway.log', type: 'file', kind: 'app', size: '14.2 MB', count: 1820, service: 'api-gateway' },
          { id: 'auth-2026-04-23', name: 'auth-service.log', type: 'file', kind: 'app', size: '8.1 MB', count: 980, service: 'auth-service' },
          { id: 'billing-json', name: 'billing.json', type: 'file', kind: 'json', size: '22.7 MB', count: 2140, service: 'billing' },
          { id: 'checkout-json', name: 'checkout.json', type: 'file', kind: 'json', size: '11.4 MB', count: 1420, service: 'checkout' },
          { id: 'worker-2026', name: 'worker-queue.log', type: 'file', kind: 'app', size: '6.8 MB', count: 720, service: 'worker-queue' },
        ],
      },
      {
        id: 'nginx',
        name: 'nginx',
        type: 'folder',
        open: true,
        children: [
          { id: 'access-log', name: 'access.log', type: 'file', kind: 'nginx', size: '44.1 MB', count: 3210 },
          { id: 'error-log', name: 'error.log', type: 'file', kind: 'app', size: '2.1 MB', count: 240, service: 'nginx' },
        ],
      },
      {
        id: 'system',
        name: 'system',
        type: 'folder',
        open: false,
        children: [
          { id: 'syslog', name: 'syslog', type: 'file', kind: 'syslog', size: '5.4 MB', count: 680 },
          { id: 'kern', name: 'kern.log', type: 'file', kind: 'syslog', size: '1.8 MB', count: 214 },
        ],
      },
      {
        id: 'crashes',
        name: 'crashes',
        type: 'folder',
        open: true,
        children: [
          { id: 'billing-trace', name: 'billing.stacktrace', type: 'file', kind: 'stacktrace', size: '180 KB', count: 22 },
        ],
      },
    ],
  },
  {
    id: 'root-live',
    name: '~/code/checkout/logs',
    path: '~/code/checkout/logs',
    type: 'folder',
    root: true,
    source: 'local-live',
    status: 'watching',
    open: true,
    children: [
      { id: 'dev-server', name: 'dev-server.log', type: 'file', kind: 'app', size: '420 KB', count: 90, service: 'dev', live: true, newCount: 12 },
      { id: 'dev-vite', name: 'vite.log', type: 'file', kind: 'app', size: '38 KB', count: 22, service: 'vite' },
      { id: 'dev-tests', name: 'jest.log', type: 'file', kind: 'app', size: '210 KB', count: 61, service: 'jest', live: true, newCount: 3 },
    ],
  },
  {
    id: 'root-remote',
    name: 'prod-edge-1',
    path: 'ssh://deploy@10.4.7.21:/var/log',
    type: 'folder',
    root: true,
    source: 'remote-ssh',
    status: 'connected',
    host: 'deploy@10.4.7.21',
    open: true,
    children: [
      { id: 'remote-nginx', name: 'nginx-access.log', type: 'file', kind: 'nginx', size: '120 MB', count: 4800 },
      { id: 'remote-app', name: 'app.log', type: 'file', kind: 'app', size: '18 MB', count: 860, service: 'app' },
      { id: 'remote-sys', name: 'syslog', type: 'file', kind: 'syslog', size: '8 MB', count: 320 },
    ],
  },
  {
    id: 'root-stream',
    name: 'kubectl logs -f api-7d8…',
    path: 'pipe://kubectl logs -f api-7d8',
    type: 'folder',
    root: true,
    source: 'stream',
    status: 'streaming',
    open: true,
    children: [
      { id: 'stream-stdout', name: 'stdout', type: 'file', kind: 'app', size: '—', count: 240, service: 'api-7d8', live: true, newCount: 28 },
      { id: 'stream-stderr', name: 'stderr', type: 'file', kind: 'app', size: '—', count: 18, service: 'api-7d8', live: true, newCount: 2 },
    ],
  },
  {
    id: 'root-cloud',
    name: 'Datadog · prod',
    path: 'datadog://prod',
    type: 'folder',
    root: true,
    source: 'cloud',
    service: 'datadog',
    status: 'connected',
    open: true,
    children: [
      { id: 'dd-svc-api', name: 'service:api', type: 'file', kind: 'app', size: 'live', count: 1280 },
      { id: 'dd-svc-billing', name: 'service:billing', type: 'file', kind: 'json', size: 'live', count: 640, service: 'billing' },
      { id: 'dd-svc-worker', name: 'service:worker', type: 'file', kind: 'app', size: 'live', count: 410, service: 'worker' },
    ],
  },
  {
    id: 'root-cloudwatch',
    name: 'CloudWatch · us-east-1',
    path: 'cloudwatch://us-east-1',
    type: 'folder',
    root: true,
    source: 'cloud',
    service: 'cloudwatch',
    status: 'connected',
    open: false,
    children: [
      { id: 'cw-lambda', name: '/aws/lambda/checkout', type: 'file', kind: 'json', size: 'live', count: 380 },
      { id: 'cw-api', name: '/aws/apigw/prod', type: 'file', kind: 'json', size: 'live', count: 920 },
    ],
  },
  {
    id: 'root-k8s',
    name: 'k8s · prod-eu',
    path: 'k8s://prod-eu',
    type: 'folder',
    root: true,
    source: 'k8s',
    status: 'connected',
    open: true,
    children: [
      {
        id: 'k8s-ns-checkout',
        name: 'checkout',
        type: 'folder',
        open: true,
        children: [
          {
            id: 'k8s-pod-api',
            name: 'pod/api-7d8b4',
            type: 'folder',
            open: true,
            children: [
              { id: 'k8s-c-api', name: 'container/api', type: 'file', kind: 'app', size: 'live', count: 920, service: 'api', live: true, newCount: 14 },
              { id: 'k8s-c-istio', name: 'container/istio-proxy', type: 'file', kind: 'app', size: 'live', count: 240, service: 'istio' },
            ],
          },
          {
            id: 'k8s-pod-worker',
            name: 'pod/worker-02',
            type: 'folder',
            open: false,
            children: [
              { id: 'k8s-c-worker', name: 'container/worker', type: 'file', kind: 'app', size: 'live', count: 380, service: 'worker' },
            ],
          },
        ],
      },
      {
        id: 'k8s-ns-ingress',
        name: 'ingress-nginx',
        type: 'folder',
        open: false,
        children: [
          {
            id: 'k8s-pod-ing',
            name: 'pod/ing-controller-9zx',
            type: 'folder',
            open: false,
            children: [
              { id: 'k8s-c-ing', name: 'container/controller', type: 'file', kind: 'nginx', size: 'live', count: 1100 },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'root-bus',
    name: 'kafka · events.prod',
    path: 'kafka://broker-1:9092/events.prod',
    type: 'folder',
    root: true,
    source: 'bus',
    service: 'kafka',
    status: 'connected',
    open: true,
    children: [
      { id: 'bus-orders', name: 'topic/orders.events', type: 'file', kind: 'json', size: 'live', count: 1840, live: true, newCount: 41 },
      { id: 'bus-payments', name: 'topic/payments.events', type: 'file', kind: 'json', size: 'live', count: 920, live: true, newCount: 8 },
      { id: 'bus-audit', name: 'topic/audit.events', type: 'file', kind: 'json', size: 'live', count: 320 },
    ],
  },
  {
    id: 'root-snapshot',
    name: 'incident-2026-04-22.zip',
    path: '~/Downloads/incident-2026-04-22.zip',
    type: 'folder',
    root: true,
    source: 'snapshot',
    status: 'frozen',
    readOnly: true,
    open: true,
    children: [
      { id: 'inc-trace', name: 'pager-trace.stacktrace', type: 'file', kind: 'stacktrace', size: '94 KB', count: 14 },
      { id: 'inc-tcpdump', name: 'capture.log', type: 'file', kind: 'syslog', size: '1.2 MB', count: 180 },
      { id: 'inc-postmortem', name: 'postmortem.json', type: 'file', kind: 'json', size: '180 KB', count: 44 },
    ],
  },
  {
    id: 'root-db',
    name: 'ClickHouse · logs.events',
    path: 'clickhouse://logs.events',
    type: 'folder',
    root: true,
    source: 'db',
    service: 'clickhouse',
    status: 'connected',
    open: false,
    children: [
      { id: 'db-q-errors', name: 'query/errors_24h', type: 'file', kind: 'app', size: 'query', count: 1420 },
      { id: 'db-q-slowapi', name: 'query/slow_api_p99', type: 'file', kind: 'app', size: 'query', count: 220 },
      { id: 'db-q-auth', name: 'query/auth_failures', type: 'file', kind: 'app', size: 'query', count: 640 },
    ],
  },
  {
    id: 'root-bookmark',
    name: 'shared · "5xx triage"',
    path: 'bookmark://shared/5xx-triage',
    type: 'folder',
    root: true,
    source: 'bookmark',
    status: 'shared',
    readOnly: true,
    open: false,
    children: [
      { id: 'bm-link-api', name: '→ api-gateway · level:error', type: 'file', kind: 'app', size: 'view', count: 320 },
      { id: 'bm-link-edge', name: '→ nginx · status:5xx', type: 'file', kind: 'nginx', size: 'view', count: 180 },
    ],
  },
];

export const FILES_BY_ID: Record<string, LvFileNode> = {};
(function walkAll(nodes: LvNode[]): void {
  nodes.forEach((node) => {
    if (node.type === 'file') FILES_BY_ID[node.id] = node;
    if (node.type === 'folder') walkAll(node.children);
  });
})(CATALOG);

export const LOG_BY_FILE: Record<string, LvLogEntry[]> = {};
Object.values(FILES_BY_ID).forEach((f) => {
  const gen: Generator =
    f.kind === 'json'
      ? genJsonLog
      : f.kind === 'nginx'
        ? genNginx
        : f.kind === 'k8s'
          ? genK8s
          : f.kind === 'syslog'
            ? genSyslog
            : f.kind === 'stacktrace'
              ? genStackTrace
              : genAppLog;
  const cap = f.kind === 'stacktrace' ? 22 : 260;
  const N = Math.min(f.count ?? cap, cap);
  const arr: LvLogEntry[] = [];
  for (let i = 0; i < N; i++) arr.push(gen(i, BASE_TS, f, f.service ?? 'system'));
  LOG_BY_FILE[f.id] = arr;
});

export const SAVED: LvSavedSearch[] = [
  { id: 'prod-errors', name: 'Prod errors (last hr)', query: 'level:error', levels: ['error'] },
  { id: 'slow-queries', name: 'Slow queries', query: 'slow query', levels: ['warn', 'error'] },
  { id: 'auth-fails', name: 'Auth failures', query: 'JWT OR login', levels: ['error', 'warn'] },
  { id: '5xx', name: '5xx responses', query: 'status:5', levels: ['error'] },
];

function normLevel(v: string): LvLogLevel {
  const s = String(v).toLowerCase();
  if (s.startsWith('err') || s === 'fatal') return 'error';
  if (s.startsWith('warn')) return 'warn';
  if (s.startsWith('deb') || s === 'dbg') return 'debug';
  if (s.startsWith('tra') || s === 'trc') return 'trace';
  return 'info';
}

function parseLine(
  raw: string,
  lineNum: number,
  fileId: string,
  node: LvFileNode,
  fallbackTs: number,
): LvLogEntry {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      const lvl = normLevel(String(obj.level ?? obj.lvl ?? obj.severity ?? 'info'));
      return {
        id: `${fileId}:${lineNum}`,
        fileId,
        line: lineNum,
        file: node.name,
        path: node.path ?? '',
        service: String(obj.service ?? obj.svc ?? node.service ?? 'local'),
        ts: String(obj.time ?? obj.ts ?? obj.timestamp ?? new Date(fallbackTs).toISOString()),
        level: lvl,
        msg: String(obj.msg ?? obj.message ?? obj.event ?? ''),
        kind: 'json',
        fields: obj,
        raw: trimmed,
      };
    } catch {
      // fall through
    }
  }
  const tsMatch = raw.match(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)/);
  const lvlMatch = raw.match(
    /\b(ERROR|ERR|FATAL|WARN|WARNING|INFO|NOTICE|DEBUG|DBG|TRACE|TRC)\b/i,
  );
  const ts = tsMatch ? tsMatch[1]! : new Date(fallbackTs).toISOString();
  const level = lvlMatch ? normLevel(lvlMatch[1]!) : 'info';
  return {
    id: `${fileId}:${lineNum}`,
    fileId,
    line: lineNum,
    file: node.name,
    path: node.path ?? '',
    service: node.service ?? 'local',
    ts,
    level,
    msg: raw.replace(tsMatch ? tsMatch[0] : '', '').trim(),
    kind: 'text',
    fields: {},
    raw,
  };
}

export function addFile({ name, text, path = '' }: { name: string; text: string; path?: string }): string {
  const firstRoot = CATALOG[0]!;
  let openedFolder = firstRoot.children.find(
    (c): c is LvFolderNode => c.type === 'folder' && c.id === '__opened__',
  );
  if (!openedFolder) {
    openedFolder = {
      id: '__opened__',
      type: 'folder',
      name: 'Opened files',
      open: true,
      children: [],
    };
    firstRoot.children.unshift(openedFolder);
  }
  const id = 'opened-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  const kind: LvLogKind = /\.json$|jsonl$/i.test(name)
    ? 'json'
    : /access|nginx/i.test(name)
      ? 'nginx'
      : /syslog|messages/i.test(name)
        ? 'syslog'
        : /k8s|kube/i.test(name)
          ? 'k8s'
          : 'app';
  const node: LvFileNode = {
    id,
    type: 'file',
    name,
    path: path || name,
    kind,
    service: 'local',
  };
  openedFolder.children.push(node);
  FILES_BY_ID[id] = node;

  const lines = text.split(/\r?\n/);
  const entries: LvLogEntry[] = [];
  const baseTs = Date.now() - 60_000 * lines.length;
  let lineNum = 1;
  for (const raw of lines) {
    if (!raw.trim()) {
      lineNum++;
      continue;
    }
    entries.push(parseLine(raw, lineNum, id, node, baseTs + lineNum * 60_000));
    lineNum++;
  }
  LOG_BY_FILE[id] = entries;
  return id;
}

export function addRootFolder({
  name,
  path = '',
  source = 'local-static',
}: { name?: string; path?: string; source?: LvCatalogRoot['source'] } = {}): string {
  const id = 'root-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  const node: LvCatalogRoot = {
    id,
    type: 'folder',
    root: true,
    name: name || 'New folder',
    path,
    source,
    open: true,
    children: [],
  };
  CATALOG.push(node);
  return id;
}

export function removeRoot(rootId: string): string[] {
  const idx = CATALOG.findIndex((r) => r.id === rootId);
  if (idx < 0) return [];
  const removed: string[] = [];
  (function walk(n: LvNode): void {
    if (n.type === 'file') {
      removed.push(n.id);
      delete FILES_BY_ID[n.id];
      delete LOG_BY_FILE[n.id];
    }
    if (n.type === 'folder') n.children.forEach(walk);
  })(CATALOG[idx]!);
  CATALOG.splice(idx, 1);
  return removed;
}

export { LEVELS };
