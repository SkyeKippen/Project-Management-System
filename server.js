// Zero-dependency server: serves public/ and persists the whole app state to data.json.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3101;
// Loopback only by default: the app has no auth and is meant to be exposed through a Cloudflare Tunnel on this host.
const HOST = process.env.HOST || '127.0.0.1';
const DATA = path.join(__dirname, 'data.json');
const PUBLIC = path.join(__dirname, 'public');

const seed = () => ({
  projects: [{
    id: 'p1', name: 'Sample Project',
    phases: [
      { id: 'ph1', name: 'Planning' },
      { id: 'ph2', name: 'Build' },
      { id: 'ph3', name: 'Test' },
      { id: 'ph4', name: 'Release' },
    ],
    tasks: [{
      id: 't1', title: 'Design the schema', description: 'Tables, relations, indexes.',
      phaseId: 'ph1', priority: 'high',
      phases: [
        { id: 'tp1', name: 'Draft', done: true },
        { id: 'tp2', name: 'Review', done: false },
        { id: 'tp3', name: 'Finalize', done: false },
      ],
    }],
  }],
});

const load = () => {
  try { return JSON.parse(fs.readFileSync(DATA, 'utf8')); }
  catch { const s = seed(); fs.writeFileSync(DATA, JSON.stringify(s, null, 2)); return s; }
};

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/api/state') {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(load()));
    }
    if (req.method === 'PUT') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          JSON.parse(body);
          fs.writeFileSync(DATA, body);
          res.writeHead(204); res.end();
        } catch { res.writeHead(400); res.end('bad json'); }
      });
      return;
    }
  }
  const file = path.join(PUBLIC, url === '/' ? 'index.html' : path.normalize(url).replace(/^(\.\.[\\/])+/, ''));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(PORT, HOST, () => console.log(`Project manager on http://${HOST}:${PORT}`));
