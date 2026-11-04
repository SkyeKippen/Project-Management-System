// State sync helpers shared by the browser and the server.
// Changes travel as small ops (set a field, insert/remove/reorder collection items) rather than whole states,
// so concurrent edits to different items, or different fields of one item, merge instead of overwriting.
// Arrays whose items all have an `id` are keyed collections; an op's path alternates object keys and item ids,
// e.g. ['projects', 'p1', 'tasks', 't1'].
(function (exports) {
  const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
  const isColl = x => Array.isArray(x) && x.every(e => e && typeof e === 'object' && 'id' in e);
  const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const clone = x => x === undefined ? x : JSON.parse(JSON.stringify(x));

  // ops that turn a into b
  function diff(a, b, path = [], ops = []) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const x = a[k], y = b[k], p = [...path, k];
      if (isColl(x) && isColl(y)) diffColl(x, y, p, ops);
      else if (isObj(x) && isObj(y)) diff(x, y, p, ops);
      else if (!same(x, y)) ops.push(y === undefined ? { op: 'set', path, key: k } : { op: 'set', path, key: k, value: clone(y) });
    }
    return ops;
  }

  function diffColl(x, y, path, ops) {
    const xs = new Map(x.map(e => [e.id, e])), ys = new Set(y.map(e => e.id));
    for (const e of x) if (!ys.has(e.id)) ops.push({ op: 'remove', path, id: e.id });
    // track the order apply() will produce, to know whether an explicit reorder is needed
    const order = x.filter(e => ys.has(e.id)).map(e => e.id);
    y.forEach((e, i) => {
      if (xs.has(e.id)) return diff(xs.get(e.id), e, [...path, e.id], ops);
      const after = i ? y[i - 1].id : null;
      ops.push({ op: 'insert', path, after, value: clone(e) });
      order.splice(after === null ? 0 : order.indexOf(after) + 1, 0, e.id);
    });
    const ids = y.map(e => e.id);
    if (!same(order, ids)) ops.push({ op: 'order', path, ids });
  }

  function resolve(root, path) {
    let cur = root;
    for (const s of path) {
      if (cur === null || typeof cur !== 'object' || typeof s !== 'string' || BAD_KEYS.has(s)) return undefined;
      cur = Array.isArray(cur) ? cur.find(e => e && e.id === s) : cur[s];
    }
    return cur;
  }

  // Applies ops in place, skipping any whose target no longer exists (e.g. it was deleted by someone else).
  // Applying the same ops twice is harmless.
  function apply(root, ops) {
    for (const o of ops) {
      if (!isObj(o) || !Array.isArray(o.path)) continue;
      const t = resolve(root, o.path);
      if (o.op === 'set') {
        if (isObj(t) && typeof o.key === 'string' && !BAD_KEYS.has(o.key)) {
          if ('value' in o) t[o.key] = clone(o.value); else delete t[o.key];
        }
        continue;
      }
      if (!Array.isArray(t)) continue;
      if (o.op === 'remove') {
        const i = t.findIndex(e => e.id === o.id);
        if (i >= 0) t.splice(i, 1);
      } else if (o.op === 'insert') {
        if (!isObj(o.value) || !('id' in o.value) || t.some(e => e.id === o.value.id)) continue;
        let i = 0;
        if (o.after !== null && o.after !== undefined) { const j = t.findIndex(e => e.id === o.after); i = j < 0 ? t.length : j + 1; }
        t.splice(i, 0, clone(o.value));
      } else if (o.op === 'order' && Array.isArray(o.ids)) {
        // listed items take the given order; any the sender didn't know about keep their place at the end
        const rank = new Map(o.ids.map((id, i) => [id, i]));
        const listed = t.filter(e => rank.has(e.id)).sort((a, b) => rank.get(a.id) - rank.get(b.id));
        t.splice(0, t.length, ...listed, ...t.filter(e => !rank.has(e.id)));
      }
    }
    return root;
  }

  Object.assign(exports, { diff, apply, clone, resolve });
})(typeof module !== 'undefined' ? module.exports : (window.Sync = {}));
