#!/usr/bin/env node
// log-viewer — minimal static HTTP server for the PWA bundle.
// Zero runtime dependencies (node:http only) — minimises supply-chain
// surface in air-gapped on-prem deployments.

import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join, normalize, resolve, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_ROOT = join(PKG_DIR, 'dist')

const HELP = `log-viewer — self-hosted PWA log viewer

Usage:
  log-viewer [options]

Options:
  --port <n>            Listen port (env PORT, default 8080)
  --host <addr>         Bind address (env HOST, default 0.0.0.0)
  --dir <path>          Static root (default <package>/dist)
  --no-sw               Disable service-worker + manifest (returns 404)
  --healthcheck-path <p>  Healthcheck path (default /healthz)
  --quiet               Suppress per-request access log
  -h, --help            Show this help
  -v, --version         Show version

Environment variables override defaults; CLI flags override env.
`

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-h' || a === '--help') out.help = true
    else if (a === '-v' || a === '--version') out.version = true
    else if (a === '--no-sw') out.noSw = true
    else if (a === '--quiet') out.quiet = true
    else if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq >= 0) out[a.slice(2, eq)] = a.slice(eq + 1)
      else {
        const next = argv[i + 1]
        if (next !== undefined && !next.startsWith('-')) {
          out[a.slice(2)] = next
          i++
        } else out[a.slice(2)] = true
      }
    } else out._.push(a)
  }
  return out
}

const args = parseArgs(process.argv.slice(2))

if (args.help) {
  process.stdout.write(HELP)
  process.exit(0)
}
if (args.version) {
  const { readFileSync } = await import('node:fs')
  const pkg = JSON.parse(
    readFileSync(join(PKG_DIR, 'package.json'), 'utf8'),
  )
  process.stdout.write(`${pkg.version}\n`)
  process.exit(0)
}

const PORT = Number(args.port ?? process.env.PORT ?? 8080)
const HOST = String(args.host ?? process.env.HOST ?? '0.0.0.0')
const ROOT = resolve(String(args.dir ?? process.env.STATIC_DIR ?? DEFAULT_ROOT))
const NO_SW = Boolean(args.noSw ?? process.env.NO_SW === '1')
const HEALTH = String(
  args['healthcheck-path'] ??
    process.env.HEALTHCHECK_PATH ??
    '/healthz',
)
const QUIET = Boolean(args.quiet ?? process.env.QUIET === '1')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jsonl': 'application/x-ndjson; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

const IMMUTABLE = /^\/assets\//
const NO_CACHE_PATHS = new Set([
  '/',
  '/index.html',
  '/sw.js',
  '/registerSW.js',
  '/manifest.webmanifest',
])
const SW_DISABLED = new Set(['/sw.js', '/registerSW.js', '/manifest.webmanifest'])

function sendBuffer(res, code, body, type) {
  res.writeHead(code, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  })
  res.end(body)
}

async function serveFile(req, res, urlPath) {
  // Strip query/hash, decode.
  let pathname = '/'
  try {
    pathname = decodeURIComponent(urlPath.split('?')[0].split('#')[0]) || '/'
  } catch {
    return sendBuffer(res, 400, 'Bad Request', 'text/plain; charset=utf-8')
  }

  // Healthcheck.
  if (pathname === HEALTH) {
    return sendBuffer(res, 200, 'ok', 'text/plain; charset=utf-8')
  }

  // Service-worker / manifest opt-out.
  if (NO_SW && SW_DISABLED.has(pathname)) {
    return sendBuffer(res, 404, 'disabled', 'text/plain; charset=utf-8')
  }

  // Resolve safely inside ROOT.
  const rel = normalize(pathname).replace(/^([/\\])+/, '')
  const candidate = resolve(ROOT, rel || 'index.html')
  if (candidate !== ROOT && !candidate.startsWith(ROOT + sep)) {
    return sendBuffer(res, 403, 'Forbidden', 'text/plain; charset=utf-8')
  }

  let file = candidate
  let st
  try {
    st = await stat(candidate)
    if (st.isDirectory()) {
      const idx = join(candidate, 'index.html')
      const idxSt = await stat(idx).catch(() => null)
      if (idxSt?.isFile()) {
        file = idx
        st = idxSt
      } else {
        st = null
      }
    } else if (!st.isFile()) {
      st = null
    }
  } catch {
    st = null
  }

  // SPA fallback: missing file + no extension → serve index.html.
  if (!st) {
    if (extname(pathname) !== '') {
      return sendBuffer(res, 404, 'Not Found', 'text/plain; charset=utf-8')
    }
    file = join(ROOT, 'index.html')
    try {
      st = await stat(file)
    } catch {
      return sendBuffer(res, 500, 'Bundle missing index.html', 'text/plain; charset=utf-8')
    }
  }

  const ext = extname(file).toLowerCase()
  const type = MIME[ext] ?? 'application/octet-stream'
  const headers = {
    'Content-Type': type,
    'Content-Length': st.size,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  }
  if (IMMUTABLE.test(pathname)) {
    headers['Cache-Control'] = 'public, max-age=31536000, immutable'
  } else if (NO_CACHE_PATHS.has(pathname) || file.endsWith('index.html')) {
    headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
  }

  res.writeHead(200, headers)
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(file)
    .on('error', () => {
      if (!res.headersSent) res.writeHead(500)
      res.end()
    })
    .pipe(res)
}

const server = createServer((req, res) => {
  const t0 = Date.now()
  const method = req.method ?? 'GET'
  if (method !== 'GET' && method !== 'HEAD') {
    return sendBuffer(res, 405, 'Method Not Allowed', 'text/plain; charset=utf-8')
  }
  res.on('finish', () => {
    if (!QUIET) {
      const ms = Date.now() - t0
      console.log(`${method} ${req.url} → ${res.statusCode} ${ms}ms`)
    }
  })
  serveFile(req, res, req.url ?? '/').catch((err) => {
    if (!res.headersSent) res.writeHead(500)
    res.end()
    console.error('handler error:', err)
  })
})

server.on('error', (err) => {
  console.error('server error:', err)
  process.exit(1)
})

function shutdown(signal) {
  console.log(`received ${signal}, shutting down…`)
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 5000).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

server.listen(PORT, HOST, () => {
  console.log(`log-viewer listening on http://${HOST}:${PORT}`)
  console.log(`  static root: ${ROOT}`)
  if (NO_SW) console.log('  service-worker: disabled (--no-sw)')
})
