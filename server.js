// Zero-dependency server: serves public/, keeps the board in memory, persists it to data.json,
// and keeps every open browser in sync. Browsers POST small change ops to /api/ops; each accepted batch
// bumps the version and the new state is pushed to everyone over Server-Sent Events (/api/events).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Sync = require('./public/sync.js');

const PORT = process.env.PORT || 3101;
// Loopback only by default: the app has no auth and is meant to be exposed through a Cloudflare Tunnel on this host.
const HOST = process.env.HOST || '127.0.0.1';
const DATA = path.join(__dirname, 'data.json');
const PUBLIC = path.join(__dirname, 'public');
const MAX_BODY = 1024 * 1024;

const seed = () => ({
  projects: [{
    id: 'p1', name: 'Sample Project',
    majorPhases: [
      { id: 'mp1', name: 'Design', stages: [
        { id: 'st1', name: 'Planning' },
        { id: 'st2', name: 'In review' },
        { id: 'st3', name: 'Approved' },
      ] },
      { id: 'mp2', name: 'Build', stages: [
        { id: 'st4', name: 'To do' },
        { id: 'st5', name: 'In progress' },
        { id: 'st6', name: 'Done' },
      ] },
    ],
    tasks: [{
      id: 't1', title: 'Design the schema', description: 'Tables, relations, indexes.',
      stageId: 'st1', priority: 'high',
      steps: [
        { id: 's1', name: 'Draft', done: true },
        { id: 's2', name: 'Review', done: false },
        { id: 's3', name: 'Finalize', done: false },
      ],
    }],
  }],
});

// Upgrades data saved by older versions. Runs once at startup, so concurrent clients can't each migrate.
function migrate(s) {
  let changed = false;
  for (const p of s.projects) {
    // project.phases (board columns) + task.phaseId -> stages of one major phase
    if (!p.majorPhases) {
      p.majorPhases = [{ id: crypto.randomUUID().slice(0, 8), name: 'Phase 1', stages: p.phases || [] }];
      for (const t of p.tasks) { t.stageId = t.phaseId; delete t.phaseId; }
      delete p.phases;
      changed = true;
    }
    // task.phases (a task's own checklist) was renamed to task.steps
    for (const t of p.tasks) if (!t.steps) { t.steps = t.phases || []; delete t.phases; changed = true; }
  }
  return changed;
}

// ---------- persistence: debounced, atomic (temp file + rename) ----------
let state, writeTimer = null;
function writeNow() {
  clearTimeout(writeTimer); writeTimer = null;
  fs.writeFileSync(DATA + '.tmp', JSON.stringify(state, null, 2));
  fs.renameSync(DATA + '.tmp', DATA);
}
const persist = () => { if (!writeTimer) writeTimer = setTimeout(writeNow, 200); };
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { if (writeTimer) writeNow(); process.exit(0); });

try { state = JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch { state = seed(); }
if (migrate(state) || !fs.existsSync(DATA)) writeNow();
// a timestamp, so versions keep increasing across restarts and reconnecting clients accept the fresh state
let version = Date.now();

// ---------- live clients ----------
const clients = new Set();
const snapshot = () => JSON.stringify({ version, state });
function broadcast() {
  const msg = `data: ${snapshot()}\n\n`;
  for (const res of clients) res.write(msg);
}
// comment lines keep idle connections open through proxies such as Cloudflare Tunnel
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25000).unref();

function readBody(req, cb) {
  let body = '', size = 0;
  req.on('data', c => { size += c.length; if (size > MAX_BODY) req.destroy(); else body += c; });
  req.on('end', () => cb(body));
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/api/state' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(snapshot());
  }
  if (url === '/api/events' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`retry: 2000\ndata: ${snapshot()}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url === '/api/ops' && req.method === 'POST') {
    return readBody(req, body => {
      let ops;
      try { ops = JSON.parse(body).ops; } catch {}
      if (!Array.isArray(ops)) { res.writeHead(400); return res.end('expected {"ops": [...]}'); }
      if (ops.length) {
        Sync.apply(state, ops);
        version = Math.max(Date.now(), version + 1);
        persist();
        broadcast();
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(snapshot());
    });
  }
  if (url.startsWith('/api/')) { res.writeHead(405); return res.end(); }

  const file = path.join(PUBLIC, url === '/' ? 'index.html' : path.normalize(url).replace(/^(\.\.[\\/])+/, ''));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}).listen(PORT, HOST, () => console.log(`Project manager on http://${HOST}:${PORT}`));
