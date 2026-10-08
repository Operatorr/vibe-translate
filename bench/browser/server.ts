// Serves two production frontend builds from one origin and proxies /api to
// the local Worker, so both builds use the same backend and database. The
// `perf-build=before` cookie selects the baseline bundle; gzip approximates
// production transfer sizes and `no-store` keeps every run cold.
//
//   PERF_BEFORE_DIST=../vibe-baseline/dist node bench/browser/server.ts
import { existsSync, readFileSync } from 'node:fs'
import { createServer, request } from 'node:http'
import { extname, join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

const PORT = 5190
const WORKER_PORT = 8787
// Better Auth trusts the Vite dev origin; present proxied requests as that.
const AUTH_ORIGIN = process.env.PERF_AUTH_ORIGIN ?? 'http://localhost:5173'
const before = process.env.PERF_BEFORE_DIST
if (!before) throw new Error('Set PERF_BEFORE_DIST to the baseline build.')
const roots = {
  before: resolve(before),
  after: resolve(process.env.PERF_AFTER_DIST ?? 'dist'),
}
for (const root of Object.values(roots))
  if (!existsSync(join(root, 'index.html')))
    throw new Error(`No production build at ${root}.`)

const types: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.mp3': 'audio/mpeg',
  '.webmanifest': 'application/manifest+json',
}

createServer((req, res) => {
  const path = new URL(req.url ?? '/', `http://localhost:${PORT}`).pathname
  if (path.startsWith('/api/')) {
    const headers = { ...req.headers, host: `localhost:${WORKER_PORT}` }
    if (headers.origin === `http://localhost:${PORT}`)
      headers.origin = AUTH_ORIGIN
    const proxy = request(
      {
        hostname: '127.0.0.1',
        port: WORKER_PORT,
        path: req.url,
        method: req.method,
        headers,
      },
      (upstream) => {
        res.writeHead(upstream.statusCode ?? 502, upstream.headers)
        upstream.pipe(res)
      },
    )
    proxy.on('error', () => {
      res.writeHead(502)
      res.end()
    })
    req.pipe(proxy)
    return
  }
  const root = req.headers.cookie?.includes('perf-build=before')
    ? roots.before
    : roots.after
  let file = resolve(root, `.${decodeURIComponent(path)}`)
  // SPA fallback for routes; never serve outside the build directory.
  if (!file.startsWith(`${root}/`) || !existsSync(file) || !extname(file))
    file = join(root, 'index.html')
  try {
    const body = readFileSync(file)
    res.setHeader(
      'content-type',
      types[extname(file)] ?? 'application/octet-stream',
    )
    res.setHeader('cache-control', 'no-store')
    if (req.headers['accept-encoding']?.includes('gzip')) {
      res.setHeader('content-encoding', 'gzip')
      res.end(gzipSync(body))
    } else res.end(body)
  } catch {
    res.writeHead(404)
    res.end()
  }
}).listen(PORT, '127.0.0.1', () =>
  console.log(`Profiling server on http://localhost:${PORT}`),
)
