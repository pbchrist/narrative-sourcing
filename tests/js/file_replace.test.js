// Dropping a second file must not glue it onto the first.
//
// addFiles() used to do `box.value = old + "\n\n" + new`. Reading twenty-two
// LinkedIn PDFs in a row on 2026-09-05, a 396-character export came back with a
// throughline about somebody else's twenty-year career, because the previous
// candidate was still sitting in the box. The output looked completely normal.
// Nothing in the UI said two people had been merged.
//
// The rule now: files chosen together are one document; a file chosen in a
// later action replaces, says so, and stashes the old text for one-click undo.

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'app.js'), 'utf8');

let pass = 0, fail = 0;
const is = (a, e, label) => {
  const ok = a === e; ok ? pass++ : fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}` +
    (ok ? '' : `\n        expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`));
};

// --- the shipped source must not contain the concatenating assignment --------
const body = src.slice(src.indexOf('async function addFiles'), src.indexOf('function parseSources'));
is(/box\.value\s*=\s*\(box\.value\.trim\(\)/.test(body), false,
   'addFiles no longer appends onto whatever was already in the box');
is(/STASH\s*=\s*\{/.test(body), true, 'the replaced text is stashed for undo');
is(/replaced/.test(body), true, 'addFiles tracks whether it replaced something');

// --- run the real function against a fake DOM -------------------------------
// Only the pieces addFiles touches, so the test exercises the shipped logic
// rather than a paraphrase of it.
const el = v => ({ value: v, innerHTML: '', className: '', textContent: '',
                   appendChild(){}, });
const dom = {
  '#profile': el(''), '#name': el(''), '#gh': el(''),
  '#status': el(''), '#out': el(''),
};
let statusMsg = '', statusAction = null;
const sandbox = {
  $: sel => dom[sel],
  status: (m, bad, action) => { statusMsg = m; statusAction = action || null; },
  readAnyFile: async f => f.text,
  LAST_FILE: null, STASH: null,
  document: { createElement: () => ({ style: {}, appendChild(){} }) },
};
const fn = new Function('ctx', `
  with (ctx) {
    ${body.replace(/^async function addFiles/, 'return async function addFiles')}
  }
`)(sandbox);

const file = (name, text) => ({ name, text });

(async () => {
  // one file into an empty box
  await fn([file('01_tracy.pdf', 'TRACY CAPERS\nDirector of Clinical Operations')]);
  is(dom['#profile'].value.includes('TRACY CAPERS'), true, 'first file lands in the box');
  is(statusAction, null, 'no undo offered when nothing was replaced');

  // a second file, chosen later — the case that broke
  await fn([file('02_patrick.pdf', 'PATRICK CHRISTELL\nTechnical Recruiter')]);
  is(dom['#profile'].value.includes('PATRICK CHRISTELL'), true, 'second file lands in the box');
  is(dom['#profile'].value.includes('TRACY CAPERS'), false,
     'the first person is GONE — two careers are never merged silently');
  is(/replaced the profile that was in the box/i.test(statusMsg), true,
     'the swap is stated in plain words, not left silent');
  is(statusAction, 'Put the previous one back', 'an undo is offered');
  is(sandbox.STASH.raw.includes('TRACY CAPERS'), true, 'the replaced text is recoverable');
  is(dom['#name'].value, '', 'the stale candidate name is cleared with the stale text');

  // two files chosen together are still one document
  dom['#profile'].value = ''; sandbox.STASH = null; statusAction = null;
  await fn([file('cv.pdf', 'RESUME BODY'), file('cover.pdf', 'COVER LETTER BODY')]);
  is(dom['#profile'].value.includes('RESUME BODY')
     && dom['#profile'].value.includes('COVER LETTER BODY'), true,
     'files chosen together are still combined — that case is intentional');
  is(statusAction, null, 'combining files chosen together is not reported as a replacement');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
