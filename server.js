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
const TRASH_KEEP = (Number(process.env.TRASH_KEEP_DAYS) || 30) * 86400e3;
const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);

const seed = () => ({
  people: [],
  projects: [{
    id: 'p1', name: 'Sample Project',
    categories: [
      { id: 'c1', name: 'Bugfix', color: '#e5484d' },
      { id: 'c2', name: 'Feature Addition', color: '#3e7bfa' },
      { id: 'c3', name: 'Optimization', color: '#30a46c' },
      { id: 'c4', name: 'Planning', color: '#f76b15' },
      { id: 'c5', name: 'Other', color: '#8b8d98' },
    ],
    tags: [{ id: 'g1', name: 'Backend', color: '#8e4ec6' }],
    majorPhases: [
      { id: 'mp1', name: 'Design', stages: [
        { id: 'st1', name: 'Planning' },
        { id: 'st2', name: 'In review' },
        { id: 'st3', name: 'Approved', done: true },
      ] },
      { id: 'mp2', name: 'Build', stages: [
        { id: 'st4', name: 'To do' },
        { id: 'st5', name: 'In progress' },
        { id: 'st6', name: 'Done', done: true },
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
  // One-off additions to existing boards, recorded in s.upgrades so they run once: a default category someone
  // later deletes on purpose isn't added back on the next restart.
  if (!Array.isArray(s.upgrades)) s.upgrades = [];
  if (!s.upgrades.includes('categories:planning+other')) {
    for (const p of s.projects) for (const c of Model.DEFAULT_CATEGORIES.filter(c => ['Planning', 'Other'].includes(c.name))) {
      if (!p.categories.some(x => x.name.toLowerCase() === c.name.toLowerCase())) p.categories.push({ id: uid(), ...c });
    }
    s.upgrades.push('categories:planning+other');
    changed = true;
  }
  // existing stages called "Done" become done stages
  if (!s.upgrades.includes('stages:done')) {
    for (const p of s.projects) for (const m of p.majorPhases) for (const st of m.stages) if (/^(done|completed?)$/i.test(st.name.trim())) st.done = true;
    s.upgrades.push('stages:done');
    changed = true;
  }
  return changed;
}

// ---------- persistence: debounced, atomic (temp file + rename) ----------
// the bin is stored in data.json, so backups include it, but it isn't part of the board sent to browsers
let state, trash = [], writeTimer = null;
function writeNow() {
  clearTimeout(writeTimer); writeTimer = null;
  fs.writeFileSync(DATA + '.tmp', JSON.stringify({ ...state, trash }, null, 2));
  fs.renameSync(DATA + '.tmp', DATA);
}
const persist = () => { if (!writeTimer) writeTimer = setTimeout(writeNow, 200); };
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { if (writeTimer) writeNow(); process.exit(0); });

try { state = JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch { state = seed(); }
trash = Array.isArray(state.trash) ? state.trash : [];
delete state.trash;
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
// a file stays on disk while the board or the bin refers to it
const taskFiles = tasks => (tasks || []).flatMap(t => (t.attachments || []).map(a => a.id));
const entryFiles = e => e.kind === 'attachment' ? [e.item.id] : e.kind === 'task' ? taskFiles([e.item]) : e.kind === 'project' ? taskFiles(e.item.tasks) : taskFiles(e.tasks);
const attachmentIds = () => new Set([...state.projects.flatMap(p => taskFiles(p.tasks)), ...trash.flatMap(entryFiles)]);
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

// ---------- recently deleted bin ----------
// Deletions are detected by comparing the board before and after each batch of ops, whatever caused them.
// One entry per thing deleted: a stage or major phase entry carries the cards deleted with it.
function captureDeletions(before, after) {
  const add = e => trash.unshift({ id: uid(), deletedAt: new Date().toISOString(), ...e });
  for (const pb of before.projects) {
    const pa = after.projects.find(p => p.id === pb.id);
    if (!pa) { add({ kind: 'project', name: pb.name, projectName: pb.name, projectId: pb.id, item: pb }); continue; }
    const base = { projectId: pb.id, projectName: pb.name };
    const tasksAfter = new Map(pa.tasks.map(t => [t.id, t]));
    const stagesAfter = new Set(pa.majorPhases.flatMap(m => m.stages.map(s => s.id)));
    const majorsAfter = new Set(pa.majorPhases.map(m => m.id));
    let removed = pb.tasks.filter(t => !tasksAfter.has(t.id));
    const tagDefs = ts => pb.tags.filter(g => ts.some(t => t.tags.includes(g.id)));
    // cards deleted with these stages, and cards orphaned by deleting them (so a restore can put them back)
    const claim = ids => {
      const tasks = removed.filter(t => ids.has(t.stageId));
      removed = removed.filter(t => !ids.has(t.stageId));
      const orphaned = pb.tasks.filter(t => ids.has(t.stageId) && tasksAfter.has(t.id)).map(t => ({ id: t.id, stageId: t.stageId }));
      return { tasks, orphaned, tagDefs: tagDefs(tasks) };
    };
    pb.majorPhases.forEach((m, index) => {
      // stages dragged to another tab are still on the board, so they aren't part of a deleted tab
      const gone = m.stages.filter(s => !stagesAfter.has(s.id));
      if (!majorsAfter.has(m.id)) {
        add({ ...base, kind: 'major', name: m.name, index, item: { ...m, stages: gone }, ...claim(new Set(gone.map(s => s.id))) });
      } else gone.forEach(st => {
        add({ ...base, kind: 'stage', name: st.name, from: m.name, majorId: m.id, index: m.stages.indexOf(st), item: st, ...claim(new Set([st.id])) });
      });
    });
    for (const t of removed) {
      const m = pb.majorPhases.find(m => m.stages.some(s => s.id === t.stageId));
      const from = m ? `${m.name} › ${m.stages.find(s => s.id === t.stageId).name}` : t.orphanedFrom;
      add({ ...base, kind: 'task', name: t.title, from, index: pb.tasks.indexOf(t), item: t, tagDefs: tagDefs([t]) });
    }
    for (const tb of pb.tasks) {
      const ta = tasksAfter.get(tb.id);
      if (ta) for (const a of tb.attachments) if (!ta.attachments.some(x => x.id === a.id)) add({ ...base, kind: 'attachment', name: a.name, from: tb.title, taskId: tb.id, item: a });
    }
  }
}
// an entry whose item is back on the board (e.g. someone used Undo) has nothing left to restore
function reconcileTrash() {
  const onBoard = e => {
    const p = state.projects.find(p => p.id === e.projectId);
    if (!p) return false;
    if (e.kind === 'project') return true;
    if (e.kind === 'task') return p.tasks.some(t => t.id === e.item.id);
    if (e.kind === 'attachment') return p.tasks.some(t => t.attachments.some(a => a.id === e.item.id));
    if (e.kind === 'major') return p.majorPhases.some(m => m.id === e.item.id);
    return p.majorPhases.some(m => m.stages.some(s => s.id === e.item.id));
  };
  trash = trash.filter(e => !onBoard(e));
}
class RestoreError extends Error {}
function takeEntry(id) {
  const i = trash.findIndex(e => e.id === id);
  if (i < 0) throw new RestoreError('That item is no longer in the bin.');
  return trash.splice(i, 1)[0];
}
// the project an entry belongs to, restoring the project too if it was deleted
function projectFor(e) {
  if (!state.projects.some(x => x.id === e.projectId)) {
    const parent = trash.find(x => x.kind === 'project' && x.item.id === e.projectId);
    if (!parent) { trash.unshift(e); throw new RestoreError(`Its project "${e.projectName}" has been permanently deleted.`); }
    restoreEntry(parent.id);
  }
  return state.projects.find(x => x.id === e.projectId);
}
const stageIds = p => new Set(p.majorPhases.flatMap(m => m.stages.map(s => s.id)));
function addBack(p, e) {
  for (const g of e.tagDefs || []) if (!p.tags.some(x => x.id === g.id)) p.tags.push(g);
  for (const t of e.tasks || []) if (!p.tasks.some(x => x.id === t.id)) p.tasks.push(t);
  // cards that the deletion orphaned go home, unless they've since been given another stage
  const stages = stageIds(p);
  for (const o of e.orphaned || []) {
    const t = p.tasks.find(x => x.id === o.id);
    if (t && !stages.has(t.stageId) && stages.has(o.stageId)) { t.stageId = o.stageId; delete t.orphanedFrom; }
  }
}
function restoreEntry(id) {
  const e = takeEntry(id);
  if (e.kind === 'project') { if (!state.projects.some(p => p.id === e.item.id)) state.projects.push(e.item); return; }
  const p = projectFor(e);
  const insertAt = (a, i, x) => a.splice(Math.min(i, a.length), 0, x);
  if (e.kind === 'task') {
    addBack(p, e);
    // its stage has gone too: back to Orphaned cards, still labelled with where it came from
    if (!stageIds(p).has(e.item.stageId)) { e.item.stageId = null; e.item.orphanedFrom = e.from; }
    if (!p.tasks.some(t => t.id === e.item.id)) insertAt(p.tasks, e.index ?? p.tasks.length, e.item);
  } else if (e.kind === 'major') {
    if (!p.majorPhases.some(m => m.id === e.item.id)) insertAt(p.majorPhases, e.index, e.item);
    addBack(p, e);
  } else if (e.kind === 'stage') {
    let m = p.majorPhases.find(x => x.id === e.majorId);
    if (!m) {
      const parent = trash.find(x => x.kind === 'major' && x.item.id === e.majorId);
      if (parent) { restoreEntry(parent.id); m = p.majorPhases.find(x => x.id === e.majorId); }
    }
    if (!m) { m = p.majorPhases[0]; if (!m) { m = { id: uid(), name: 'Restored', stages: [] }; p.majorPhases.push(m); } }
    if (!m.stages.some(s => s.id === e.item.id)) insertAt(m.stages, e.index, e.item);
    addBack(p, e);
  } else if (e.kind === 'attachment') {
    let t = p.tasks.find(x => x.id === e.taskId);
    if (!t) {
      // the card was deleted after the attachment: bring the card back as well
      const parent = trash.find(x => x.projectId === e.projectId && (x.kind === 'task' ? x.item.id === e.taskId : (x.tasks || []).some(y => y.id === e.taskId)));
      if (!parent) { trash.unshift(e); throw new RestoreError(`Its card "${e.from}" has been permanently deleted.`); }
      restoreEntry(parent.id);
      t = p.tasks.find(x => x.id === e.taskId);
    }
    if (t && !t.attachments.some(a => a.id === e.item.id)) t.attachments.push(e.item);
  }
}
const trashList = () => trash.map(e => ({ id: e.id, kind: e.kind, name: e.name, from: e.from, projectId: e.projectId, projectName: e.projectName,
  deletedAt: e.deletedAt, expiresAt: new Date(Date.parse(e.deletedAt) + TRASH_KEEP).toISOString(),
  cards: e.kind === 'project' ? e.item.tasks.length : (e.tasks || []).length }));
function purgeTrash() {
  const had = attachmentIds(), n = trash.length;
  trash = trash.filter(e => Date.now() - Date.parse(e.deletedAt) <= TRASH_KEEP);
  if (trash.length === n) return;
  const has = attachmentIds();
  removeFiles([...had].filter(id => !has.has(id)));
  changedByServer();
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

// ---------- live clients ----------
const clients = new Set();
const snapshot = () => JSON.stringify({ version, state, trashCount: trash.length });
function broadcast() {
  const msg = `data: ${snapshot()}\n\n`;
  for (const res of clients) res.write(msg);
}
// comment lines keep idle connections open through proxies such as Cloudflare Tunnel
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25000).unref();

// a change made by the server itself: save it and tell every browser
function changedByServer() {
  Model.normalizeState(state, uid);
  version = Math.max(Date.now(), version + 1);
  persist();
  broadcast();
}

// runs after the definitions above, since purging the bin tells browsers
function housekeeping() {
  try { purgeTrash(); } catch (err) { console.error('Bin purge failed:', err.message); }
  backupTick();
}
housekeeping();
setInterval(housekeeping, Math.min(BACKUP_EVERY, 3600e3));

function readBody(req, cb) {
  let body = '', size = 0;
  req.on('data', c => { size += c.length; if (size > MAX_BODY) req.destroy(); else body += c; });
  req.on('end', () => cb(body));
}

// who is asking, per Cloudflare Access (no header means no Access in front of this request): the matching People
// entry, created on first sight. An existing person named like the email's first part is linked to it.
function me(req, res) {
  const email = String(req.headers['cf-access-authenticated-user-email'] || '').trim().toLowerCase();
  let person = null;
  if (email) {
    person = state.people.find(x => (x.email || '').toLowerCase() === email);
    if (!person) {
      const local = email.split('@')[0] || email;
      person = state.people.find(x => !x.email && x.name.trim().toLowerCase() === local);
      if (person) person.email = email;
      else { person = { id: uid(), name: local[0].toUpperCase() + local.slice(1), email }; state.people.push(person); }
      changedByServer();
    }
  }
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ personId: person ? person.id : null }));
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
          delete state.trash;  // the bin isn't part of the synced board
          Model.normalizeState(state, uid);
          captureDeletions(before, state);
          reconcileTrash();
        } catch { state = before; res.writeHead(400); return res.end('invalid ops'); }
        // deleted things wait in the bin, so this only removes files nothing refers to at all
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
  if (url === '/api/me' && req.method === 'GET') return me(req, res);
  if (url === '/api/trash' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(trashList()));
  }
  const trashMatch = url.match(/^\/api\/trash\/([\w-]+)(\/restore)?$/);
  if (trashMatch && (trashMatch[2] ? req.method === 'POST' : req.method === 'DELETE')) {
    const had = attachmentIds(), before = Sync.clone(trash);
    try {
      if (trashMatch[2]) restoreEntry(trashMatch[1]); else takeEntry(trashMatch[1]);
    } catch (err) {
      if (!(err instanceof RestoreError)) throw err;
      trash = before;
      res.writeHead(409); return res.end(err.message);
    }
    const has = attachmentIds();
    removeFiles([...had].filter(id => !has.has(id)));
    changedByServer();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(snapshot());
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
