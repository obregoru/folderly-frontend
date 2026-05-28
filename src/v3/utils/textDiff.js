// Word-level text diff for the proposal-review preview.
//
// Given two HTML strings, returns a HTML fragment with unchanged
// text plain, added text wrapped in <ins.diff-add>, and deleted
// text wrapped in <del.diff-del>. The operator-facing preview
// pipes this into an iframe so the reviewer can see at a glance
// what changed between current (live) and proposed body.
//
// Algorithm:
//   1. Strip HTML to plain text (preserving paragraph breaks via
//      double-newlines).
//   2. Tokenize into words + whitespace + punctuation. Whitespace
//      tokens are preserved so the rebuilt output keeps original
//      spacing — diffing them would just produce noise.
//   3. Compute LCS between non-whitespace tokens using the classic
//      DP approach. Capped at MAX_TOKENS to prevent runaway memory
//      on large bodies; over the cap, falls back to paragraph-level
//      diff which is coarser but always finishes.
//   4. Walk back to emit `=` (equal), `+` (added in proposed), `-`
//      (removed from current) ops + render to HTML.
//
// Output classes (`diff-add` / `diff-del`) get styled by the
// caller's CSS — typically green background for additions, red
// strikethrough background for deletions. <ins>/<del> tags are
// the semantic HTML elements browsers + screen readers already
// understand.

const MAX_TOKENS = 4000; // ~800-900 sentences; LCS table is ~32MB at this size

// Strip HTML to plain text, preserving paragraph + heading breaks
// as double-newlines so the diff output stays scannable. Block-level
// tags collapse to `\n\n`; inline tags vanish; multiple spaces
// collapse. Entities are decoded.
function htmlToPlainText(html) {
  if (!html || typeof html !== 'string') return '';
  let s = html;
  // Strip WP Gutenberg block markers + arbitrary HTML comments.
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  // Block-level closing tags → newline.
  s = s.replace(/<\/(?:p|div|section|article|blockquote|figure|h[1-6]|li|tr|td|th|ul|ol|table|header|footer|nav|main|aside)\s*>/gi, '\n\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  // Strip all remaining tags.
  s = s.replace(/<[^>]+>/g, '');
  // Decode common entities.
  const entities = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#039;': "'",
    '&apos;': "'", '&nbsp;': ' ', '&mdash;': '—', '&ndash;': '–',
    '&hellip;': '…', '&ldquo;': '"', '&rdquo;': '"', '&lsquo;': "'",
    '&rsquo;': "'",
  };
  s = s.replace(/&(?:amp|lt|gt|quot|apos|nbsp|mdash|ndash|hellip|ldquo|rdquo|lsquo|rsquo|#039);/g, (m) => entities[m] || m);
  s = s.replace(/&#(\d+);/g, (m, n) => {
    const num = Number(n);
    return Number.isFinite(num) ? String.fromCharCode(num) : m;
  });
  // Collapse 3+ newlines → 2 (paragraph break).
  s = s.replace(/\n{3,}/g, '\n\n');
  // Collapse runs of spaces/tabs (but NOT newlines).
  s = s.replace(/[ \t]+/g, ' ');
  return s.trim();
}

// Tokenize text into a sequence of either content tokens (words +
// punctuation) or whitespace tokens. Both are preserved in order
// so we can reconstruct the original spacing. Returns
// `{ all, contentIdx }` — all = every token, contentIdx = positions
// of content tokens (so LCS operates on content only).
function tokenize(text) {
  const all = [];
  const contentIdx = [];
  // Split on whitespace runs; the regex keeps the whitespace via a
  // capture group.
  const parts = text.split(/(\s+)/);
  for (const p of parts) {
    if (!p) continue;
    if (/^\s+$/.test(p)) {
      all.push({ kind: 'ws', text: p });
    } else {
      // Content chunk — split further on punctuation so 'hello,' diffs
      // independently from 'hello'. We keep punctuation as its own token.
      const sub = p.split(/([.,!?;:()\[\]{}"'—–"-])/);
      for (const t of sub) {
        if (!t) continue;
        contentIdx.push(all.length);
        all.push({ kind: 'word', text: t });
      }
    }
  }
  return { all, contentIdx };
}

// Build LCS table of content tokens. Returns the table; caller
// walks it for the edit script. O(N*M) time + memory. Caller has
// already ensured N+M is within MAX_TOKENS budget.
function lcsTable(a, b) {
  const n = a.length, m = b.length;
  // Use typed arrays for cache locality.
  const dp = new Int32Array((n + 1) * (m + 1));
  const stride = m + 1;
  for (let i = 1; i <= n; i++) {
    const ai = a[i - 1];
    for (let j = 1; j <= m; j++) {
      if (ai === b[j - 1]) {
        dp[i * stride + j] = dp[(i - 1) * stride + (j - 1)] + 1;
      } else {
        const up = dp[(i - 1) * stride + j];
        const left = dp[i * stride + (j - 1)];
        dp[i * stride + j] = up >= left ? up : left;
      }
    }
  }
  return { dp, stride };
}

// Walk the LCS table to produce an edit script. Each op is
// { type: '=' | '-' | '+', a?: idx, b?: idx } where a/b are
// indices into the original content arrays.
function lcsEditScript(a, b) {
  const { dp, stride } = lcsTable(a, b);
  const ops = [];
  let i = a.length, j = b.length;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      ops.push({ type: '=', a: i - 1, b: j - 1 });
      i--; j--;
    } else {
      const up = dp[(i - 1) * stride + j];
      const left = dp[i * stride + (j - 1)];
      if (up >= left) {
        ops.push({ type: '-', a: i - 1 });
        i--;
      } else {
        ops.push({ type: '+', b: j - 1 });
        j--;
      }
    }
  }
  while (i > 0) { ops.push({ type: '-', a: i - 1 }); i--; }
  while (j > 0) { ops.push({ type: '+', b: j - 1 }); j--; }
  ops.reverse();
  return ops;
}

// Escape HTML for safe insertion into the output. Whitespace tokens
// (including newlines) pass through untouched — newlines render as
// `\n` which CSS `white-space: pre-wrap` honors.
function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Group consecutive runs of the same op type so we emit one
// <ins>/<del> wrapper per run rather than per-token (cleaner DOM,
// fewer reflows, easier to read).
function groupOps(ops) {
  const groups = [];
  let cur = null;
  for (const op of ops) {
    if (!cur || cur.type !== op.type) {
      if (cur) groups.push(cur);
      cur = { type: op.type, items: [op] };
    } else {
      cur.items.push(op);
    }
  }
  if (cur) groups.push(cur);
  return groups;
}

// Coarser fallback when bodies exceed MAX_TOKENS. Splits both into
// paragraphs (separated by \n\n) and emits an `entire paragraph
// added/removed` style diff. Cheaper but still useful.
function paragraphDiff(currentText, proposedText) {
  const pa = currentText.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
  const pb = proposedText.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
  const setA = new Set(pa);
  const setB = new Set(pb);
  const parts = [];
  // Walk in proposed order — additions in green, kept paragraphs plain;
  // then a separate "removed paragraphs" block at the bottom.
  for (const p of pb) {
    if (setA.has(p)) parts.push(`<p>${escapeHtml(p)}</p>`);
    else parts.push(`<ins class="diff-add"><p>${escapeHtml(p)}</p></ins>`);
  }
  const removed = pa.filter(p => !setB.has(p));
  if (removed.length > 0) {
    parts.push('<hr><p style="color:#6b7280;font-size:0.9em;">⚠ Removed paragraphs (no longer in proposed):</p>');
    for (const p of removed) {
      parts.push(`<del class="diff-del"><p>${escapeHtml(p)}</p></del>`);
    }
  }
  return parts.join('\n');
}

// Public API: returns HTML string with diff highlights.
// Pass `currentHtml` (left side / live) and `proposedHtml` (right
// side / new). Output is suitable to drop into an iframe srcDoc
// (newlines render thanks to white-space:pre-wrap in the caller's
// CSS).
export function diffHtml(currentHtml, proposedHtml) {
  const currentText = htmlToPlainText(currentHtml);
  const proposedText = htmlToPlainText(proposedHtml);
  if (!currentText && !proposedText) return '<p style="color:#9ca3af;font-style:italic;">(both empty)</p>';
  if (!currentText) return `<ins class="diff-add">${escapeHtml(proposedText)}</ins>`;
  if (!proposedText) return `<del class="diff-del">${escapeHtml(currentText)}</del>`;

  const a = tokenize(currentText);
  const b = tokenize(proposedText);
  const aContent = a.contentIdx.map(i => a.all[i].text);
  const bContent = b.contentIdx.map(i => b.all[i].text);

  // Token-budget guard. LCS DP table is (n+1)*(m+1) Int32 entries.
  if (aContent.length + bContent.length > MAX_TOKENS) {
    return paragraphDiff(currentText, proposedText);
  }

  const ops = lcsEditScript(aContent, bContent);
  const groups = groupOps(ops);

  // Build output token-by-token. For an `=` token, emit unchanged.
  // For `+` token, emit content; we also need to splice in any
  // whitespace tokens from the proposed array that sit BETWEEN the
  // matched content tokens. Same for `-` from current. Approach:
  // walk groups in order, for each group emit the content tokens
  // wrapped in the appropriate tag, with whitespace from the
  // corresponding source spliced in.
  const out = [];
  // Helper to emit a slice of "all" tokens between two contentIdx
  // values, escaping for HTML.
  const sliceText = (allArr, contentIdxArr, start, end) => {
    const lo = contentIdxArr[start];
    const hi = end >= contentIdxArr.length ? allArr.length : contentIdxArr[end];
    let s = '';
    for (let k = lo; k < hi; k++) s += allArr[k].text;
    return s;
  };
  // Track which content indices in a/b we've emitted up to.
  let aCursor = 0; // next content-idx to emit from a
  let bCursor = 0;

  for (const g of groups) {
    if (g.type === '=') {
      // Equal run — emit from b (proposed), advancing both cursors.
      const firstB = g.items[0].b;
      const lastB = g.items[g.items.length - 1].b + 1;
      // First, if there are pending content tokens between cursor
      // and the first equal index that fell off (shouldn't happen
      // for `=` since ops are sequential), skip.
      const text = sliceText(b.all, b.contentIdx, firstB, lastB);
      out.push(escapeHtml(text));
      aCursor = g.items[g.items.length - 1].a + 1;
      bCursor = lastB;
    } else if (g.type === '+') {
      const firstB = g.items[0].b;
      const lastB = g.items[g.items.length - 1].b + 1;
      const text = sliceText(b.all, b.contentIdx, firstB, lastB);
      out.push(`<ins class="diff-add">${escapeHtml(text)}</ins>`);
      bCursor = lastB;
    } else if (g.type === '-') {
      const firstA = g.items[0].a;
      const lastA = g.items[g.items.length - 1].a + 1;
      const text = sliceText(a.all, a.contentIdx, firstA, lastA);
      out.push(`<del class="diff-del">${escapeHtml(text)}</del>`);
      aCursor = lastA;
    }
  }
  return out.join('');
}

// Lightweight stats so the caller can show "+45 / -12 words" badges.
export function diffStats(currentHtml, proposedHtml) {
  const currentText = htmlToPlainText(currentHtml);
  const proposedText = htmlToPlainText(proposedHtml);
  if (!currentText && !proposedText) return { added: 0, removed: 0, unchanged: 0 };
  const a = tokenize(currentText);
  const b = tokenize(proposedText);
  const aContent = a.contentIdx.map(i => a.all[i].text);
  const bContent = b.contentIdx.map(i => b.all[i].text);
  if (aContent.length + bContent.length > MAX_TOKENS) {
    // Approximate: count unique-paragraph differences.
    const pa = new Set(currentText.split(/\n{2,}/).map(s => s.trim()).filter(Boolean));
    const pb = new Set(proposedText.split(/\n{2,}/).map(s => s.trim()).filter(Boolean));
    let added = 0, removed = 0, unchanged = 0;
    for (const p of pb) (pa.has(p) ? (unchanged++) : (added++));
    for (const p of pa) if (!pb.has(p)) removed++;
    return { added, removed, unchanged, approx: true };
  }
  const ops = lcsEditScript(aContent, bContent);
  let added = 0, removed = 0, unchanged = 0;
  for (const op of ops) {
    if (op.type === '=') unchanged++;
    else if (op.type === '+') added++;
    else removed++;
  }
  return { added, removed, unchanged };
}
