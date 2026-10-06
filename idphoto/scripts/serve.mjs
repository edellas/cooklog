// Local server: serves dist/ and runs functions/api/* exactly like Cloudflare
// Pages Functions would (same handler signature). Env vars come from .dev.vars
// (KEY=value lines) or the process environment; payments default to "mock".
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.wasm': 'application/wasm',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.task': 'application/octet-stream',
  '.tflite': 'application/octet-stream',
  '.webmanifest': 'application/manifest+json',
};

function loadEnv() {
  const env = { PAYMENT_PROVIDER: 'mock' };
  const file = join(root, '.dev.vars');
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  for (const k of Object.keys(process.env)) if (/^(PAYMENT_|POLAR_|STRIPE_|PUBLIC_)/.test(k)) env[k] = process.env[k];
  return env;
}

async function toRequest(req, url) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  return new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
}

async function handleApi(req, res, url, env) {
  const name = url.pathname.replace(/^\/api\//, '').replace(/[^a-z0-9-]/gi, '');
  const file = join(root, 'functions', 'api', `${name}.js`);
  if (!existsSync(file)) return send(res, 404, 'not found');
  const mod = await import(pathToFileURL(file).href);
  const method = req.method[0] + req.method.slice(1).toLowerCase();
  const handler = mod[`onRequest${method}`] || mod.onRequest;
  if (!handler) return send(res, 405, 'method not allowed');
  const response = await handler({ request: await toRequest(req, url), env, params: {} });
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

function send(res, status, body, type = 'text/plain') {
  res.writeHead(status, { 'content-type': type });
  res.end(body);
}

export function startServer({ port = 8788, dist = join(root, 'dist'), extraStatic = {} } = {}) {
  const env = loadEnv();
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url, env);
      let file = null;
      for (const [prefix, target] of Object.entries(extraStatic)) {
        if (url.pathname.startsWith(prefix)) file = join(root, target, decodeURIComponent(url.pathname.slice(prefix.length)));
        if (url.pathname === prefix && !prefix.endsWith('/')) file = join(root, target);
      }
      if (!file) {
        file = normalize(join(dist, decodeURIComponent(url.pathname)));
        if (!file.startsWith(dist)) return send(res, 403, 'forbidden');
      }
      let st = await stat(file).catch(() => null);
      if (st?.isDirectory()) {
        file = join(file, 'index.html');
        st = await stat(file).catch(() => null);
      }
      if (!st) {
        const notFound = join(dist, '404.html');
        if (existsSync(notFound)) return send(res, 404, await readFile(notFound), TYPES['.html']);
        return send(res, 404, 'not found');
      }
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(await readFile(file));
    } catch (err) {
      console.error(err);
      send(res, 500, 'error');
    }
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${server.address().port}`;
      resolve({ url, close: () => server.close() });
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 8788);
  const { url } = await startServer({ port });
  console.log(`Serving dist/ on ${url} (payments: ${loadEnv().PAYMENT_PROVIDER})`);
}
