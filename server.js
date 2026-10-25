// server.js - LOCAL web face for the agent (Phase 2 preview).
//
// Run:  node server.js   ->  open http://localhost:3737
//
// The browser page NEVER sees the API keys: this little Node server
// holds them (via lib/loadEnv.js) and calls the same lib/runAgent.js
// brain the CLI uses. This is exactly the production pattern, shrunk:
// on the real site, this server's job moves into a Netlify Function.
//
// LOCALHOST ONLY - do not expose this port to the internet: it can
// submit to the directory with your keys.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { loadEnv } = require('./lib/loadEnv');
const { runAgent } = require('./lib/runAgent');
const { DISH_OPTIONS } = require('./lib/dishes');
const { readPhoto } = require('./lib/photoRead');

loadEnv();
const PORT = 3737;
const ROOT = __dirname;

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(path.join(ROOT, 'web.html'), 'utf8'));
      return;
    }
    if (req.method === 'GET' && req.url === '/api/dish-options') {
      sendJson(res, 200, { options: DISH_OPTIONS });
      return;
    }
    if (req.method === 'GET' && req.url === '/dialog') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(path.join(ROOT, 'dialog-test.html'), 'utf8'));
      return;
    }
    if (req.method === 'GET' && req.url === '/add-agent-dialog.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      res.end(fs.readFileSync(path.join(ROOT, 'add-agent-dialog.js'), 'utf8'));
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/photos/')) {
      const file = path.basename(req.url.split('?')[0]);
      const fp = path.join(ROOT, 'photos', file);
      if (fs.existsSync(fp)) {
        const ext = path.extname(fp).toLowerCase();
        const type = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
        res.writeHead(200, { 'Content-Type': type });
        res.end(fs.readFileSync(fp));
        return;
      }
      res.writeHead(404); res.end('not found');
      return;
    }
    if (req.method === 'POST' && req.url === '/api/read-photo') {
      // Photo prefill: a browser-downscaled data URL, so the cap is
      // 2MB here (the run route stays at 100KB - it carries no image).
      let body = '';
      req.on('data', c => { body += c; if (body.length > 2000000) req.destroy(); });
      req.on('end', async () => {
        try {
          const input = JSON.parse(body || '{}');
          const result = await readPhoto({ image: input.image });
          sendJson(res, 200, result);
        } catch (err) {
          sendJson(res, 500, { name: null, city: null, dishes: [], reason: `Server error: ${err.message}` });
        }
      });
      return;
    }
    if (req.method === 'POST' && req.url === '/api/run') {
      let body = '';
      req.on('data', c => { body += c; if (body.length > 100000) req.destroy(); });
      req.on('end', async () => {
        try {
          const input = JSON.parse(body || '{}');
          input.via = 'web-local';
          const result = await runAgent(input, () => {});
          sendJson(res, 200, result);
        } catch (err) {
          sendJson(res, 500, { outcome: 'blocked', message: `Server error: ${err.message}` });
        }
      });
      return;
    }
    res.writeHead(404); res.end('not found');
  } catch (err) {
    res.writeHead(500); res.end(String(err && err.message));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Jain Restaurants Agent - local web page: http://localhost:${PORT}`);
  console.log('Keys loaded server-side only. Ctrl+C to stop.');
});
