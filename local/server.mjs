// Runs Dom Obroki on an ordinary Windows or Linux computer: serves the built site (../site) and answers
// POST /api with the same code as the cloud function (../functions/api). Settings come from local/nastavitve.env.
import './env.mjs';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(here, '../site');
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '127.0.0.1';
const MAX_BODY = 25 * 1024 * 1024; // student import with a large spreadsheet

const { handler } = await import('../functions/api/index.mjs');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function api(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch {
    res.writeHead(413, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Zahteva je prevelika' }));
    return;
  }
  const out = await handler({
    requestContext: { http: { method: req.method, sourceIp: req.socket.remoteAddress } },
    headers: req.headers,
    body,
  });
  res.writeHead(out.statusCode || 200, out.headers || {}).end(out.body || '');
}

// Static files; any other path is the app itself (index.html)
async function file(req, res) {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let p = path.resolve(SITE, `.${url}`);
  if (!p.startsWith(SITE)) { res.writeHead(403).end(); return; }
  let data;
  try {
    if ((await fs.stat(p)).isDirectory()) p = path.join(p, 'index.html');
    data = await fs.readFile(p);
  } catch {
    p = path.join(SITE, 'index.html');
    data = await fs.readFile(p);
  }
  const hashed = p.includes(`${path.sep}assets${path.sep}`);
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(p).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(req.method === 'HEAD' ? undefined : data);
}

http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/api')) await api(req, res);
    else if (req.method === 'GET' || req.method === 'HEAD') await file(req, res);
    else res.writeHead(405).end();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Napaka na strežniku');
  }
}).on('error', err => {
  console.error(err.code === 'EADDRINUSE' ? `Vrata ${PORT} že uporablja drug program – v local/nastavitve.env nastavite drug PORT.` : err.message);
  process.exit(1);
}).listen(PORT, HOST, () => {
  const where = HOST === '0.0.0.0' || HOST === '::' ? `http://<ime-ali-IP-tega-računalnika>:${PORT}` : `http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}`;
  console.log(`Dom Obroki teče na ${where}  (ustavite s Ctrl+C)`);
});
