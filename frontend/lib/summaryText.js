// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

// Text helpers for bill summaries and their AI plain-English versions.
//
// Congress.gov's CRS summaries arrive with some HTML still in them
// ("<strong>Title</strong>", "&nbsp;"), and the profile printed it as
// text. The AI plain-English versions use **bold** labels, which printed
// with their asterisks. These helpers turn both into plain text and
// simple bold runs, without ever rendering HTML from the source.

const NAMED_ENTITIES = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  rsquo: '\u2019',
  lsquo: '\u2018',
  rdquo: '\u201d',
  ldquo: '\u201c',
  hellip: '\u2026',
  sect: '\u00a7',
};

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 ? String.fromCodePoint(n) : m;
    }
    const v = NAMED_ENTITIES[code.toLowerCase()];
    return v === undefined ? m : v;
  });
}

// Every tag out, repeated until nothing changes: one pass over "<scr<b>ipt>"
// would leave "<script>" behind. The result is only ever shown as text.
function stripTags(s) {
  let prev;
  do {
    prev = s;
    s = s.replace(/<[^>]*>/g, '');
  } while (s !== prev);
  return s;
}

/**
 * A CRS summary or Federal Register abstract as clean paragraphs of text:
 * paragraph and list tags become paragraph breaks, <br> a line break,
 * every other tag is dropped, entities are decoded. Returns an array of
 * paragraph strings (empty for no text).
 */
export function summaryParagraphs(text) {
  if (!text) return [];
  let s = String(text)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|ul|ol|div|h[1-6])\s*>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '\u2022 ');
  s = stripTags(s);
  s = decodeEntities(s).replace(/\u00a0/g, ' ');
  return s
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim())
    .filter(Boolean);
}

/**
 * One line of AI markdown as runs of plain and bold text:
 * "**Scope**: the rest" -> [{ text: 'Scope', bold: true }, { text: ': the rest' }].
 * Unpaired asterisks are left as they are.
 */
export function inlineRuns(line) {
  const out = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) out.push({ text: line.slice(last, m.index) });
    out.push({ text: m[1], bold: true });
    last = re.lastIndex;
  }
  if (last < line.length) out.push({ text: line.slice(last) });
  return out;
}

/**
 * A ballot measure's AI explanation (2026-10-24) in its three parts:
 * the opening paragraph(s), the bullets, and the closing vote lines
 * ("**A Yes vote means:** ..."). Returns { paras, bullets, votes }, where
 * each vote is { label, text } with the label's trailing colon dropped.
 * Lines are kept as markdown text for inlineRuns; headings read as plain
 * lines; anything unexpected after the bullets stays a bullet, as on bills.
 */
export function explainerParts(markdown) {
  const paras = [];
  const bullets = [];
  const votes = [];
  if (!markdown) return { paras, bullets, votes };
  let inBullets = false;
  for (const raw of String(markdown).split('\n')) {
    const line = raw.trim().replace(/^#{1,6}\s+/, '');
    if (!line) continue;
    const vote = line.match(/^\*\*\s*(A\s+(?:Yes|No)\s+vote\s+means)\s*:?\s*\*\*\s*:?\s*(.*)$/i);
    if (vote) {
      votes.push({ label: vote[1].replace(/\s+/g, ' '), text: vote[2].trim() });
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      inBullets = true;
      bullets.push(line.slice(2).trim());
    } else if (inBullets) {
      bullets.push(line);
    } else {
      paras.push(line);
    }
  }
  return { paras, bullets, votes };
}
