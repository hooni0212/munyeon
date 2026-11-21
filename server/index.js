import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';
import { createApp } from './app.js';
import { createMockModel, createModel } from './model.js';
import { deploymentConfig } from './config.js';

process.umask(0o077);
const config = deploymentConfig();
const root = fileURLToPath(new URL('../', import.meta.url));
const dist = resolve(root, 'dist');
const database = resolve(root, process.env.MUNYEON_DB || 'data/munyeon.sqlite');
await mkdir(dirname(database), { recursive: true });
const model = config.aiMock ? createMockModel() : createModel(config.aiEnabled ? {
  baseUrl: process.env.MUNYEON_AI_URL, model: process.env.MUNYEON_AI_MODEL, key: process.env.MUNYEON_AI_KEY,
  outputLimitField: process.env.MUNYEON_AI_OUTPUT_LIMIT_FIELD,
} : {});
const app = createApp({ database, origin: config.origin, aiDailyLimit: config.aiDailyLimit, model });
// 파일 업로드(base64)만 큰 요청을 받는다.
const bodyLimit = path => /\/(import|extract)$/.test(path) ? 15_000_000 : 600_000;
const media = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const server = createServer({ requestTimeout: 30_000, headersTimeout: 10_000 }, async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    if (config.origin) {
      res.setHeader('Content-Security-Policy', "default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    }
    if (url.pathname === '/healthz' && req.method === 'GET') {
      res.writeHead(app.ready() ? 200 : 503, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }).end('munyeon');
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > bodyLimit(url.pathname)) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: '요청이 너무 커요.' }));
          return;
        }
        chunks.push(chunk);
      }
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const proxyIP = req.headers['x-munyeon-client-ip'];
      const ip = config.trustProxy && typeof proxyIP === 'string' && isIP(proxyIP) ? proxyIP : req.socket.remoteAddress;
      const response = await app.handle(new Request(url, { method: req.method, headers: req.headers, body }), { ip });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405).end();
      return;
    }
    const file = resolve(dist, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(dist + sep) || !Object.hasOwn(media, extname(file))) {
      res.writeHead(404).end();
      return;
    }
    const contents = await readFile(file).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (!contents) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('npm run build 후 다시 열어 주세요.');
      return;
    }
    res.writeHead(200, { 'Content-Type': media[extname(file)],
      'Cache-Control': url.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : contents);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});

server.once('error', error => {
  console.error('문연 서버를 열 수 없어요. (' + error.code + ')');
  app.close();
  process.exitCode = 1;
});
server.listen(config.port, config.host, () => console.log('문연 ' + (config.origin || 'http://127.0.0.1:' + server.address().port)));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => { app.close(); process.exit(0); }));
}
