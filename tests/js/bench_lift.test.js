// The bench harness lifts its gates out of docs/app.js by string slicing, so a
// rename in the app silently empties a slice and the benchmark then measures
// nothing while still printing a number. This asserts every lifted symbol is
// really there, offline, before anyone trusts a corpus run.

const fs = require('fs');
const path = require('path');
const REPO = path.join(__dirname, '..', '..');
const src = fs.readFileSync(path.join(REPO, 'docs', 'app.js'), 'utf8');
const bench = fs.readFileSync(path.join(REPO, 'bench', 'corpus.mjs'), 'utf8');

let pass = 0, fail = 0;
const is = (a, e, label) => {
  const ok = a === e; ok ? pass++ : fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}` +
    (ok ? '' : `\n        expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`));
};

// Every cut(a,b) the harness performs must find both boundaries, in order, and
// enclose a non-trivial span.
const cuts = [...bench.matchAll(/cut\("((?:[^"\\]|\\.)*)","((?:[^"\\]|\\.)*)"\)/g)]
  .map(m => [m[1], m[2]]);
is(cuts.length > 0, true, 'harness performs at least one cut');
for (const [a, b] of cuts) {
  const i = src.indexOf(a), j = src.indexOf(b);
  is(i >= 0, true, `boundary present in app.js: ${JSON.stringify(a)}`);
  is(j >= 0, true, `boundary present in app.js: ${JSON.stringify(b)}`);
  is(i >= 0 && j > i && j - i > 40, true, `cut is non-empty and ordered: ${JSON.stringify(a)}`);
}

// Every symbol the harness re-exports must be defined inside what it cut.
const lifted = cuts.map(([a, b]) => src.slice(src.indexOf(a), src.indexOf(b))).join('\n');
const exported = [...bench.matchAll(/exports\.(\w+)\s*=\s*(\w+)/g)].map(m => m[2]);
is(exported.length > 0, true, 'harness re-exports at least one symbol');
for (const name of [...new Set(exported)]) {
  const defined = new RegExp(`(function|const|let|var)\\s+${name}\\b`).test(lifted);
  is(defined, true, `lifted span defines ${name}`);
}

// The guard is the newest gate and the one most likely to be left out.
is([...new Set(exported)].includes('scanSendable'), true,
   'harness measures the no-sendable-text guard');

// The corpus must include the hostile cases, not just clean résumés.
for (const id of ['THIN', 'NOT_A_PROFILE', 'REAL_LINKEDIN_01', 'SENDABLE_BAIT'])
  is(bench.includes(`id:"${id}"`), true, `corpus includes ${id}`);
is(fs.existsSync(path.join(REPO, 'bench', 'profiles', 'real_linkedin_01.txt')), true,
   'the real scraped LinkedIn fixture exists on disk');

// Parallelism is the point of the rewrite; a reintroduced serial loop is a bug.
is(/await pooled\(/.test(bench), true, 'corpus runs through the pool');

// This repo lives under a directory whose name contains a space, an ampersand
// and an emoji. URL.pathname leaves those percent-encoded, so the harness
// resolved to a path that does not exist and died before its first request.
const benchCode = bench.replace(/^\s*\/\/.*$/gm, '');
is(/\.pathname/.test(benchCode), false, 'harness does not build paths from URL.pathname');
is(/fileURLToPath/.test(bench), true, 'harness decodes its own location');
// Resolve exactly the way the harness does, from bench/, and confirm every
// input it opens is actually reachable from this checkout's real location.
{
  const { fileURLToPath, pathToFileURL } = require('node:url');
  const benchUrl = pathToFileURL(path.join(REPO, 'bench', 'corpus.mjs'));
  const resolved = fileURLToPath(new URL('..', benchUrl));
  for (const f of ['docs/app.js', 'docs/endpoint.json', 'ablation/profiles.json',
                   'ablation/profiles-long.json', 'bench/profiles/real_linkedin_01.txt'])
    is(fs.existsSync(resolved + f), true, `harness resolves ${f}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
