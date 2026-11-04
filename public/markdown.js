// Small, safe Markdown renderer for card descriptions. All text is HTML-escaped first, only the tags below are
// ever produced, and links must be http(s) or mailto, so a description can't inject markup or run script.
// Supports: # headings, **bold**, *italic*/_italic_, ~~strike~~, `code`, ``` code blocks ```, [links](https://…),
// bare https:// links, - / 1. lists, - [ ] / - [x] task items, > quotes, --- rules.
(function (exports) {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const LINK = (href, text) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  const LIST = /^\s*([-*+]|\d+\.)\s+(.*)$/;
  const BLOCK_START = /^(```|#{1,4}\s|&gt;|\s*([-*+]|\d+\.)\s+|\s*(---|\*\*\*)\s*$)/;

  // s is already escaped
  function inline(s) {
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => /^(https?:\/\/|mailto:)/i.test(url) ? LINK(url, text) : m);
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_, pre, url) => pre + LINK(url, url));
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^\w])__([^_]+)__(?!\w)/g, '$1<strong>$2</strong>');
    s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>').replace(/(^|[^\w])_([^_\s][^_]*)_(?!\w)/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
  }

  // lines are already escaped
  function blocks(lines) {
    const out = [];
    let i = 0, m;
    while (i < lines.length) {
      const l = lines[i];
      if (/^```/.test(l)) {
        const buf = [];
        for (i++; i < lines.length && !/^```/.test(lines[i]); i++) buf.push(lines[i]);
        i++;
        out.push(`<pre><code>${buf.join('\n')}</code></pre>`);
      } else if ((m = l.match(/^(#{1,4})\s+(.*)$/))) {
        const n = m[1].length + 2;  // # renders as h3: keeps headings modest inside a dialog
        out.push(`<h${n}>${inline(m[2])}</h${n}>`); i++;
      } else if (/^\s*(---|\*\*\*)\s*$/.test(l)) {
        out.push('<hr>'); i++;
      } else if (/^&gt;/.test(l)) {
        const buf = [];
        while (i < lines.length && /^&gt;/.test(lines[i])) buf.push(lines[i++].replace(/^&gt;\s?/, ''));
        out.push(`<blockquote>${blocks(buf)}</blockquote>`);
      } else if ((m = l.match(LIST))) {
        const ordered = /\d/.test(m[1]), items = [];
        while (i < lines.length && (m = lines[i].match(LIST)) && /\d/.test(m[1]) === ordered) {
          const task = m[2].match(/^\[([ xX])\]\s+(.*)$/);
          items.push(task ? `<li class="task">${task[1] === ' ' ? '☐' : '☑'} ${inline(task[2])}</li>` : `<li>${inline(m[2])}</li>`);
          i++;
        }
        const tag = ordered ? 'ol' : 'ul';
        out.push(`<${tag}>${items.join('')}</${tag}>`);
      } else if (!l.trim()) {
        i++;
      } else {
        // paragraph: consecutive plain lines; single line breaks are kept
        const buf = [lines[i++]];
        while (i < lines.length && lines[i].trim() && !BLOCK_START.test(lines[i])) buf.push(lines[i++]);
        out.push(`<p>${buf.map(inline).join('<br>')}</p>`);
      }
    }
    return out.join('');
  }

  exports.render = src => blocks(esc(String(src || '').replace(/\u0000/g, '')).replace(/\r\n?/g, '\n').split('\n'));
})(typeof module !== 'undefined' ? module.exports : (window.Markdown = {}));
