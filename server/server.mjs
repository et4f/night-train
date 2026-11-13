/**
 * 夜宿火车 · 本地服务
 * 零依赖静态服务器：web/ 为前端，data/ 为数据。
 * 运行：node server/server.mjs   （默认 http://127.0.0.1:8787）
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let p = decodeURIComponent(url.pathname);
    if (p === '/' || p === '') p = '/index.html';

    // 只允许访问 web/ 与 data/
    let file;
    if (p.startsWith('/data/')) file = path.join(ROOT, 'data', p.slice(6));
    else file = path.join(ROOT, 'web', p);
    file = path.resolve(file);

    const okRoot = [path.join(ROOT, 'web'), path.join(ROOT, 'data')].some((r) =>
      file.startsWith(r + path.sep)
    );
    if (!okRoot) {
      res.writeHead(403).end('forbidden');
      return;
    }

    const buf = await fs.readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  } catch (e) {
    if (e.code === 'ENOENT') res.writeHead(404).end('not found');
    else {
      console.error(e);
      res.writeHead(500).end('server error');
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`夜宿火车 已启动 →  http://${HOST}:${PORT}`);
});
