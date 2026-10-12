// Usage : CSP="$(cat client/scripts/web-bench/csp.txt)" node client/scripts/web-bench/serve.mjs  (serveur API sur :8080)
// Banc local : sert client/dist avec la CSP de production candidate, relaie /api, /uploads et /ws.
import http from 'node:http'
import net from 'node:net'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

const DIST = new URL('../../dist', import.meta.url).pathname
const CSP = process.env.CSP
const EXTRA = JSON.parse(process.env.EXTRA_HEADERS || '{}')
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.tflite': 'application/octet-stream', '.task': 'application/octet-stream' }

const proxy = (req, res) => {
  const p = http.request({ host: '127.0.0.1', port: 8080, path: req.url, method: req.method, headers: { ...req.headers, 'x-real-ip': '127.0.0.1' } }, r => {
    res.writeHead(r.statusCode, r.headers); r.pipe(res)
  })
  p.on('error', () => { res.writeHead(502); res.end() })
  req.pipe(p)
}

http.createServer((req, res) => {
  const path = req.url.split('?')[0]
  if (path.startsWith('/api/') || path.startsWith('/uploads/')) return proxy(req, res)
  let f = join(DIST, decodeURIComponent(path))
  if (!f.startsWith(DIST) || !existsSync(f) || statSync(f).isDirectory()) f = join(DIST, 'index.html')
  const headers = { 'content-type': TYPES[extname(f)] ?? 'application/octet-stream', ...EXTRA }
  if (CSP && extname(f) === '.html') headers['content-security-policy'] = CSP
  res.writeHead(200, headers)
  res.end(readFileSync(f))
}).on('upgrade', (req, sock, head) => {
  const up = net.connect(8080, '127.0.0.1', () => {
    up.write(`${req.method} ${req.url} HTTP/1.1\r\n` + Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n')
    up.write(head); sock.pipe(up); up.pipe(sock)
  })
  up.on('error', () => sock.destroy())
}).listen(8099, () => console.log('banc web sur :8099'))
