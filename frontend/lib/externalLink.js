// CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

/**
 * Outbound-link labeling.
 *
 * PRODUCT RULE (Jeffrey, 2026-08): we never render a link that silently
 * downloads a file to someone's computer. If a link points at a file
 * rather than a page, the label has to say so BEFORE the click.
 *
 * This is not only a courtesy. Every "Source" and "Website" link on this
 * product is an invitation to go check our work — that is the entire
 * basis of the sourcing claim we make to voters, reporters and two app
 * stores. A citation that ambushes the reader with a download teaches
 * them not to click the next one, which quietly destroys the thing the
 * citations exist to build.
 *
 * Enforcement lives here rather than at each call site because the
 * offending URLs arrive from DATA, not from code: 173 Mississippi
 * legislators had a raw .xml stored in `official_website`, and 120
 * Vermont legislators had a district-map .pdf in the same field. No
 * amount of care at the call site would have caught those, because the
 * call site just renders whatever the record holds.
 */

// Extensions a browser will download (or dump as raw text) rather than
// render as a page. Deliberately conservative: only formats we have
// actually seen in the data or would plausibly cite. Images are absent
// on purpose — they belong in <img>, never behind a text link.
const FILE_KINDS = {
  pdf: 'PDF',
  txt: 'text file',
  csv: 'CSV',
  tsv: 'TSV',
  xml: 'XML',
  json: 'JSON',
  xls: 'spreadsheet',
  xlsx: 'spreadsheet',
  doc: 'document',
  docx: 'document',
  ppt: 'slide deck',
  pptx: 'slide deck',
  zip: 'ZIP archive',
  gz: 'archive',
};

/**
 * What kind of thing does this URL point at?
 * Returns null for ordinary pages, or { ext, label } for a direct file.
 */
export function linkKind(url) {
  if (!url || typeof url !== 'string') return null;
  let pathname;
  try {
    // Parse rather than regex the whole string: a query string like
    // ?doc=report.pdf must NOT count — the resource is the page, and
    // labeling it a download would be its own small lie.
    pathname = new URL(url, 'https://example.invalid').pathname;
  } catch {
    return null;
  }
  const match = /\.([a-z0-9]{1,5})$/i.exec(pathname);
  if (!match) return null;
  const ext = match[1].toLowerCase();
  const label = FILE_KINDS[ext];
  return label ? { ext, label } : null;
}

/** Host without the www, for display. */
export function hostLabel(url) {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * The suffix to show after a link's text, or '' for an ordinary page.
 * e.g. " (PDF)" — short enough to sit inline without wrapping a row.
 */
export function fileSuffix(url) {
  const kind = linkKind(url);
  return kind ? ` (${kind.label})` : '';
}

/**
 * "a PDF" but "an XML" — the article follows how the label is SPOKEN,
 * not how it is spelled. Initialisms read as letters ("ex-em-el") take
 * "an" despite starting with a consonant, which is why a naive vowel
 * check gets this wrong.
 */
function article(label) {
  return /^[aeiou]/i.test(label) || /^(XML|XLS|SVG|HTML|RSS|MP3|MP4)/i.test(label) ? 'an' : 'a';
}

/**
 * Props every outbound link should carry. `title` gives the full warning
 * on hover and to screen readers, where the short inline suffix alone
 * would be ambiguous.
 */
export function externalLinkProps(url) {
  const kind = linkKind(url);
  return {
    href: url,
    target: '_blank',
    rel: 'noopener noreferrer',
    ...(kind
      ? { title: `Opens ${article(kind.label)} ${kind.label} (.${kind.ext}) — this may download to your device` }
      : {}),
  };
}
