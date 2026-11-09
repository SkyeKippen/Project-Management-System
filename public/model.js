// Board rules shared by the browser and the server. The server runs normalizeState after every change,
// so cards stay valid even when two people edit at once (e.g. one deletes a tag while another adds it to a card).
(function (exports) {
  const PRIORITIES = ['urgent', 'high', 'medium', 'low'];
  const SIZES = ['tiny', 'small', 'medium', 'large', 'huge'];
  const MAX_TAGS = 5;
  const DEFAULT_CATEGORY = 'Feature Addition';
  const DEFAULT_CATEGORIES = [
    { name: 'Bugfix', color: '#e5484d' },
    { name: 'Feature Addition', color: '#3e7bfa' },
    { name: 'Optimization', color: '#30a46c' },
    { name: 'Planning', color: '#f76b15' },
    { name: 'Other', color: '#8b8d98' },
  ];
  const DECISION_STATUSES = ['proposed', 'accepted', 'rejected', 'superseded'];
  const BUG_TYPES = ['Crash', 'Gameplay', 'UI / Visual', 'Performance', 'Other'];
  const TAG_COLORS =['#3e7bfa', '#30a46c', '#e5484d', '#f5a524', '#8e4ec6', '#12a594', '#d6409f', '#6e7781'];

  // a real calendar date written "YYYY-MM-DD" (checked in UTC, so it means the same day everywhere)
  const validDate = s => {
    const d = typeof s === 'string' && /^\d{4}-\d\d-\d\d$/.test(s) && new Date(s + 'T00:00:00Z');
    return !!d && !isNaN(d) && d.toISOString().slice(0, 10) === s;
  };
  const newCategories = uid => DEFAULT_CATEGORIES.map(c => ({ id: uid(), ...c }));
  // the category new cards get: the project's chosen one, else Feature Addition, else the first
  const defaultCategory = p => p.categories.find(c => c.id === p.defaultCategoryId) ||
    p.categories.find(c => c.name === DEFAULT_CATEGORY) || p.categories[0];

  // People are shared by all projects; cards and steps point at them by id. Returns true if anything changed.
  function normalizeState(s, uid) {
    let changed = false;
    if (!Array.isArray(s.people)) { s.people = []; changed = true; }
    for (const x of s.people) if ('reviewer' in x && x.reviewer !== true) { delete x.reviewer; changed = true; }
    const personIds = new Set(s.people.map(x => x.id));
    for (const p of s.projects) if (normalizeProject(p, uid, personIds)) changed = true;
    return changed;
  }

  // returns true if anything changed
  function normalizeProject(p, uid, personIds = new Set()) {
    let changed = false;
    const fix = (cond, f) => { if (cond) { f(); changed = true; } };
    fix(!Array.isArray(p.tasks), () => { p.tasks = []; });
    fix(!Array.isArray(p.tags), () => { p.tags = []; });
    fix(!Array.isArray(p.categories) || !p.categories.length, () => { p.categories = newCategories(uid); });
    // exactly one Bugs major phase, always called Bugs, placed last when it's first added; its rows are bug types
    if (Array.isArray(p.majorPhases)) {
      const bugs = p.majorPhases.filter(m => m.kind === 'bugs');
      fix(!bugs.length, () => { p.majorPhases.push({ id: uid(), name: 'Bugs', kind: 'bugs', stages: BUG_TYPES.map(name => ({ id: uid(), name })) }); });
      for (const extra of bugs.slice(1)) fix(true, () => { delete extra.kind; });
      const b = p.majorPhases.find(m => m.kind === 'bugs');
      fix(b.name !== 'Bugs', () => { b.name = 'Bugs'; });
      for (const st of b.stages) fix('done' in st, () => { delete st.done; });
    }
    // exactly one default category: a missing or deleted one falls back as defaultCategory() does
    fix(!p.categories.some(c => c.id === p.defaultCategoryId), () => { p.defaultCategoryId = defaultCategory(p).id; });
    const tagIds = new Set(p.tags.map(t => t.id)), catIds = new Set(p.categories.map(c => c.id));
    for (const t of p.tasks) {
      const tags = Array.isArray(t.tags) ? [...new Set(t.tags.filter(id => tagIds.has(id)))].slice(0, MAX_TAGS) : [];
      fix(JSON.stringify(tags) !== JSON.stringify(t.tags), () => { t.tags = tags; });
      fix(!catIds.has(t.categoryId), () => { t.categoryId = defaultCategory(p).id; });
      fix(!PRIORITIES.includes(t.priority), () => { t.priority = 'medium'; });
      fix('size' in t && !SIZES.includes(t.size), () => { delete t.size; });
      fix(!Array.isArray(t.attachments), () => { t.attachments = []; });
      fix(!Array.isArray(t.steps), () => { t.steps = []; });
      fix(!Array.isArray(t.comments), () => { t.comments = []; });
      fix('resolved' in t && t.resolved !== true, () => { delete t.resolved; });
      // a deadline is a calendar date with no time of day or timezone, "YYYY-MM-DD"
      fix('due' in t && !validDate(t.due), () => { delete t.due; });
      // a card in review: { status: pending | declined, by, byName, at, reason? }. Anything else malformed stays in review.
      if ('review' in t) {
        fix(t.review === null || typeof t.review !== 'object', () => { t.review = { status: 'pending', by: '', byName: 'Someone', at: '' }; });
        fix(!['pending', 'declined'].includes(t.review.status), () => { t.review.status = 'pending'; });
      }
      // an assignee who was deleted (perhaps at the same moment) leaves the card or step unassigned
      for (const x of [t, ...t.steps]) fix('assigneeId' in x && !personIds.has(x.assigneeId), () => { delete x.assigneeId; });
    }
    // decisions log
    fix(!Array.isArray(p.decisions), () => { p.decisions = []; });
    for (const d of p.decisions) {
      fix(!DECISION_STATUSES.includes(d.status), () => { d.status = 'proposed'; });
      for (const k of ['title', 'summary', 'body']) fix(typeof d[k] !== 'string', () => { d[k] = ''; });
      fix(d.date !== '' && !/^\d{4}-\d\d-\d\d$/.test(d.date), () => { d.date = ''; });
      for (const k of ['deciders', 'cardIds', 'history', 'comments', 'attachments']) fix(!Array.isArray(d[k]), () => { d[k] = []; });
      const deciders = [...new Set(d.deciders.filter(id => personIds.has(id)))];
      fix(deciders.length !== d.deciders.length, () => { d.deciders = deciders; });
      // links to cards and older decisions are kept even if those are deleted, so restoring them from the bin
      // restores the link too; the page only shows links to things that exist
      fix('supersedes' in d && (typeof d.supersedes !== 'string' || d.supersedes === d.id), () => { delete d.supersedes; });
    }
    // a tag no card uses any more (orphaned cards count) is removed, to keep the tag list and filter bar tidy
    const used = new Set(p.tasks.flatMap(t => t.tags));
    fix(p.tags.some(x => !used.has(x.id)), () => { p.tags = p.tags.filter(x => used.has(x.id)); });
    return changed;
  }

  Object.assign(exports, { DEFAULT_CATEGORIES, PRIORITIES, SIZES, MAX_TAGS, TAG_COLORS, newCategories, defaultCategory, normalizeState, validDate });
})(typeof module !== 'undefined' ? module.exports : (window.Model = {}));
