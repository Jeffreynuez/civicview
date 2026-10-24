// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.
//
// Checks for lib/summaryText.js (2026-10-20): a profile's bill summary
// printed Congress.gov's HTML as text ("<strong>", "&nbsp;"), and the AI
// plain-English version printed its **bold** labels with the asterisks.
// 2026-10-24: and a ballot measure explanation splits into its paragraph,
// bullets and the two vote lines (explainerParts).
// Run: npm run test:summary-text

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const out = mkdtempSync(path.join(tmpdir(), 'cv-summary-test-'));
const file = path.join(out, 'summaryText.mjs');
await build({
  entryPoints: [path.join(root, 'lib/summaryText.js')],
  bundle: true, format: 'esm', platform: 'node', outfile: file, logLevel: 'silent',
});
const { summaryParagraphs, inlineRuns, explainerParts } = await import(pathToFileURL(file).href);

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log('PASS ' + name);
  } catch (e) {
    failures += 1;
    console.log('FAIL ' + name + '\n  ' + e.message);
  }
}

check('a CRS summary as it is stored today: tags dropped, entities decoded', () => {
  const stored = '<strong>Fairness for Victims of SNAP Skimming Act of 2025</strong>\n\n'
    + 'Specifically, using funds provided by the Department of Agriculture, a state agency must provide a household with '
    + 'replacement SNAP benefits equal to the amount of benefits&nbsp;stolen.&nbsp;\n\n'
    + 'Further,&nbsp;the replacement amount is limited.';
  const paras = summaryParagraphs(stored);
  assert.equal(paras.length, 3);
  assert.equal(paras[0], 'Fairness for Victims of SNAP Skimming Act of 2025');
  assert.ok(paras[1].endsWith('equal to the amount of benefits stolen.'));
  assert.equal(paras[2], 'Further, the replacement amount is limited.');
  for (const p of paras) {
    assert.ok(!/[<>]/.test(p) && !/&[a-z#0-9]+;/i.test(p), 'no tag or entity left in: ' + p);
  }
});

check('raw Congress.gov HTML: paragraphs and list items', () => {
  const html = '<p><strong>Title</strong></p><p>One &amp; two.</p><ul><li>First</li><li>Second &#8212; third</li></ul>';
  assert.deepEqual(summaryParagraphs(html), ['Title', 'One & two.', '\u2022 First', '\u2022 Second \u2014 third']);
});

check('a script tag in the source stays text, never markup', () => {
  const paras = summaryParagraphs('Safe <script>alert(1)</script>text');
  assert.deepEqual(paras, ['Safe alert(1)text']);
});

check('a tag split around another tag is still taken out', () => {
  const paras = summaryParagraphs('A <scr<b>ipt>x</scr</b>ipt> B');
  assert.equal(paras.length, 1);
  assert.ok(!/<[a-z/]/i.test(paras[0]), 'no tag left in: ' + paras[0]);
});

check('empty input', () => {
  assert.deepEqual(summaryParagraphs(''), []);
  assert.deepEqual(summaryParagraphs(null), []);
});

check('**bold** labels become bold runs', () => {
  assert.deepEqual(inlineRuns('**Scope**: the bill makes it permanent.'), [
    { text: 'Scope', bold: true },
    { text: ': the bill makes it permanent.' },
  ]);
  assert.deepEqual(inlineRuns('Plain text, a lone * star.'), [{ text: 'Plain text, a lone * star.' }]);
});

check('a ballot measure explanation splits into paragraph, bullets and the two vote lines', () => {
  const md = 'This amendment would let Florida keep more money in its rainy day fund.\n\n'
    + '- The cap rises from 10% to 25% of general revenue.\n'
    + '- It needs **60%** of the vote to pass.\n\n'
    + '**A Yes vote means:** the cap rises to 25%.\n'
    + '**A No vote means:** the cap stays at 10%.';
  const { paras, bullets, votes } = explainerParts(md);
  assert.deepEqual(paras, ['This amendment would let Florida keep more money in its rainy day fund.']);
  assert.deepEqual(bullets, ['The cap rises from 10% to 25% of general revenue.', 'It needs **60%** of the vote to pass.']);
  assert.deepEqual(votes, [
    { label: 'A Yes vote means', text: 'the cap rises to 25%.' },
    { label: 'A No vote means', text: 'the cap stays at 10%.' },
  ]);
});

check('vote lines are found with the colon outside the bold, and in any case', () => {
  const { votes, bullets } = explainerParts('- one\n**A yes vote means**: it passes.\n**A NO VOTE MEANS:** it does not.');
  assert.deepEqual(bullets, ['one']);
  assert.deepEqual(votes.map((v) => v.text), ['it passes.', 'it does not.']);
});

check('no text gives empty parts', () => {
  assert.deepEqual(explainerParts(''), { paras: [], bullets: [], votes: [] });
  assert.deepEqual(explainerParts(null), { paras: [], bullets: [], votes: [] });
});

if (failures) {
  console.log(failures + ' failed');
  process.exit(1);
}
console.log('all passed');
