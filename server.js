// Zero-dependency server: serves public/, keeps the board in memory, persists it to data.json,
// and keeps every open browser in sync. Browsers POST small change ops to /api/ops; each accepted batch
// bumps the version and the new state is pushed to everyone over Server-Sent Events (/api/events).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const Sync = require('./public/sync.js');
const Model = require('./public/model.js');

const PORT = process.env.PORT || 3101;
// All interfaces by default, so a Cloudflare Tunnel on another machine can reach it. The app has no auth of its own:
// keep the port closed to anything but the tunnel. '::' accepts IPv4 and IPv6; falls back to 0.0.0.0 without IPv6.
const HOST = process.env.HOST || '::';
const DATA = path.join(__dirname, 'data.json');
const PUBLIC = path.join(__dirname, 'public');
const MAX_BODY = 1024 * 1024;
const UPLOADS = path.join(__dirname, 'uploads');
const MAX_UPLOAD = (Number(process.env.MAX_UPLOAD_MB) || 25) * 1024 * 1024;
const BACKUPS = path.join(__dirname, 'backups');
const BACKUP_EVERY = (Number(process.env.BACKUP_INTERVAL_HOURS) || 12) * 3600e3;
const BACKUP_KEEP = (Number(process.env.BACKUP_KEEP_DAYS) || 14) * 86400e3;
const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);

const seed = () => ({
  people: [],
  projects: [{
    id: 'p1', name: 'Sample Project',
    categories: [
      { id: 'c1', name: 'Bugfix', color: '#e5484d' },
      { id: 'c2', name: 'Feature Addition', color: '#3e7bfa' },
      { id: 'c3', name: 'Optimization', color: '#30a46c' },
    ],
    tags: [{ id: 'g1', name: 'Backend', color: '#8e4ec6' }],
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
      stageId: 'st1', priority: 'high', size: 'medium', categoryId: 'c2', tags: ['g1'], attachments: [],
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
      p.majorPhases = [{ id: uid(), name: 'Phase 1', stages: p.phases || [] }];
      for (const t of p.tasks) { t.stageId = t.phaseId; delete t.phaseId; }
      delete p.phases;
      changed = true;
    }
    // task.phases (a task's own checklist) was renamed to task.steps
    for (const t of p.tasks) if (!t.steps) { t.steps = t.phases || []; delete t.phases; changed = true; }
  }
  // people list, categories (existing cards become Feature Addition), tags, attachments, 4-level priority
  if (Model.normalizeState(s, uid)) changed = true;
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
if (migrate(state) && fs.existsSync(DATA)) {
  // keep the file as it was before this version upgraded it (not pruned with the regular backups)
  fs.mkdirSync(BACKUPS, { recursive: true });
  fs.copyFileSync(DATA, path.join(BACKUPS, `pre-upgrade-${new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}.json`));
  writeNow();
} else if (!fs.existsSync(DATA)) writeNow();
// a timestamp, so versions keep increasing across restarts and reconnecting clients accept the fresh state
let version = Date.now();

// ---------- attachments: uploads/<id> holds the bytes, uploads/<id>.json its name and type ----------
fs.mkdirSync(UPLOADS, { recursive: true });
const attachmentIds = () => new Set(state.projects.flatMap(p => p.tasks.flatMap(t => t.attachments.map(a => a.id))));
function removeFiles(ids) {
  for (const id of ids) for (const f of [id, id + '.json']) fs.rm(path.join(UPLOADS, f), { force: true }, () => {});
}
const cleanName = n => (n || '').replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '_').trim().slice(0, 200) || 'file';

// POST /api/files, raw body, name in X-Filename (URI-encoded); streams to disk and returns the attachment record
function upload(req, res) {
  const fail = (code, msg) => { if (!res.headersSent) { res.writeHead(code); res.end(msg); } };
  if (Number(req.headers['content-length']) > MAX_UPLOAD) { req.resume(); return fail(413, 'file too large'); }
  let name;
  try { name = cleanName(decodeURIComponent(req.headers['x-filename'] || '')); } catch { name = 'file'; }
  const type = String(req.headers['content-type'] || 'application/octet-stream').slice(0, 100);
  const id = crypto.randomUUID().replace(/-/g, ''), dest = path.join(UPLOADS, id);
  const out = fs.createWriteStream(dest);
  let size = 0, aborted = false;
  const abort = (code, msg) => { if (aborted) return; aborted = true; req.unpipe(out); out.destroy(); removeFiles([id]); req.resume(); fail(code, msg); };
  req.on('data', c => { size += c.length; if (size > MAX_UPLOAD) abort(413, 'file too large'); });
  req.on('aborted', () => abort(400, 'upload aborted'));
  out.on('error', () => abort(500, 'could not save file'));
  out.on('finish', () => {
    if (aborted) return;
    const meta = { id, name, type, size, uploadedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(UPLOADS, id + '.json'), JSON.stringify(meta));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(meta));
  });
  req.pipe(out);
}

// always a download, never rendered by the browser, so an uploaded HTML/SVG file can't run script on this origin
function download(id, res) {
  let meta;
  try { meta = JSON.parse(fs.readFileSync(path.join(UPLOADS, id + '.json'), 'utf8')); } catch { res.writeHead(404); return res.end('not found'); }
  const isImage = /^image\/(png|jpeg|gif|webp)$/.test(meta.type);
  res.writeHead(200, {
    'Content-Type': isImage ? meta.type : 'application/octet-stream',
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': 'private, max-age=86400',
  });
  fs.createReadStream(path.join(UPLOADS, id)).on('error', () => res.end()).pipe(res);
}

// ---------- backups: backups/data-YYYYMMDD-HHMMSS.json (UTC) every 12h, kept 14 days ----------
const backupTime = f => {
  const m = f.match(/^data-(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)(\d\d)\.json$/);
  return m && Date.UTC(m[1], m[2] - 1, m[3], m[4], m[5], m[6]);
};
function backupTick() {
  try {
    fs.mkdirSync(BACKUPS, { recursive: true });
    const now = Date.now();
    const backups = fs.readdirSync(BACKUPS).map(f => ({ f, t: backupTime(f) })).filter(b => b.t);
    for (const b of backups) if (now - b.t > BACKUP_KEEP) fs.rmSync(path.join(BACKUPS, b.f), { force: true });
    if (!backups.some(b => now - b.t < BACKUP_EVERY)) {
      if (writeTimer) writeNow();
      const stamp = new Date(now).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
      fs.copyFileSync(DATA, path.join(BACKUPS, `data-${stamp}.json`));
      console.log(`Backup written: backups/data-${stamp}.json`);
    }
    // uploads never attached to a card (e.g. the dialog was closed mid-upload), after a day's grace
    const keep = attachmentIds();
    for (const f of fs.readdirSync(UPLOADS)) {
      const id = f.replace(/\.json$/, '');
      if (!keep.has(id) && now - fs.statSync(path.join(UPLOADS, f)).mtimeMs > 86400e3) removeFiles([id]);
    }
  } catch (err) { console.error('Backup failed:', err.message); }
}
backupTick();
setInterval(backupTick, Math.min(BACKUP_EVERY, 3600e3));

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

const server = http.createServer((req, res) => {
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
        const before = Sync.clone(state), hadFiles = attachmentIds();
        try {
          Sync.apply(state, ops);
          Model.normalizeState(state, uid);
        } catch { state = before; res.writeHead(400); return res.end('invalid ops'); }
        // files of attachments that were removed, or whose card was deleted
        const hasFiles = attachmentIds();
        removeFiles([...hadFiles].filter(id => !hasFiles.has(id)));
        version = Math.max(Date.now(), version + 1);
        persist();
        broadcast();
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(snapshot());
    });
  }
  if (url === '/api/files' && req.method === 'POST') return upload(req, res);
  if (url.startsWith('/api/')) { res.writeHead(405); return res.end(); }
  const fileMatch = url.match(/^\/files\/([0-9a-f]{32})(\/|$)/);
  if (fileMatch && req.method === 'GET') return download(fileMatch[1], res);

  const file = path.join(PUBLIC, url === '/' ? 'index.html' : path.normalize(url).replace(/^(\.\.[\\/])+/, ''));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
});

function urls() {
  const any = HOST === '::' || HOST === '0.0.0.0';
  if (!any) return [HOST.includes(':') ? `[${HOST}]` : HOST];
  const lan = Object.values(os.networkInterfaces()).flat().filter(a => a && !a.internal && a.family === 'IPv4').map(a => a.address);
  return ['127.0.0.1', ...lan];
}
server.on('listening', () => console.log(`Project manager listening on ${server.address().address} port ${PORT}:\n` +
  urls().map(h => `  http://${h}:${PORT}`).join('\n')));
server.on('error', err => {
  if (HOST === '::' && !process.env.HOST && ['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(err.code)) return server.listen(PORT, '0.0.0.0');
  throw err;
});
server.listen(PORT, HOST);
