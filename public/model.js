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
  ];
  const TAG_COLORS = ['#3e7bfa', '#30a46c', '#e5484d', '#f5a524', '#8e4ec6', '#12a594', '#d6409f', '#6e7781'];

  const newCategories = uid => DEFAULT_CATEGORIES.map(c => ({ id: uid(), ...c }));
  const defaultCategory = p => p.categories.find(c => c.name === DEFAULT_CATEGORY) || p.categories[0];

  // People are shared by all projects; cards and steps point at them by id. Returns true if anything changed.
  function normalizeState(s, uid) {
    let changed = false;
    if (!Array.isArray(s.people)) { s.people = []; changed = true; }
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
    const tagIds = new Set(p.tags.map(t => t.id)), catIds = new Set(p.categories.map(c => c.id));
    for (const t of p.tasks) {
      const tags = Array.isArray(t.tags) ? [...new Set(t.tags.filter(id => tagIds.has(id)))].slice(0, MAX_TAGS) : [];
      fix(JSON.stringify(tags) !== JSON.stringify(t.tags), () => { t.tags = tags; });
      fix(!catIds.has(t.categoryId), () => { t.categoryId = defaultCategory(p).id; });
      fix(!PRIORITIES.includes(t.priority), () => { t.priority = 'medium'; });
      fix('size' in t && !SIZES.includes(t.size), () => { delete t.size; });
      fix(!Array.isArray(t.attachments), () => { t.attachments = []; });
      fix(!Array.isArray(t.steps), () => { t.steps = []; });
      // an assignee who was deleted (perhaps at the same moment) leaves the card or step unassigned
      for (const x of [t, ...t.steps]) fix('assigneeId' in x && !personIds.has(x.assigneeId), () => { delete x.assigneeId; });
    }
    return changed;
  }

  Object.assign(exports, { PRIORITIES, SIZES, MAX_TAGS, TAG_COLORS, newCategories, defaultCategory, normalizeState });
})(typeof module !== 'undefined' ? module.exports : (window.Model = {}));
