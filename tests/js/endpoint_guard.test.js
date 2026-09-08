// The endpoint resolver, as it ships in the browser.
//
// docs/endpoint.json is written by something outside this repo, and for two
// weeks it named a Cloudflare quick tunnel that no longer resolved. The sister
// app sat on that dead address telling everybody the machine was asleep while
// the machine was awake. The published file overrode the stable constant, so
// having a good fallback saved nobody.
//
// These assertions are what makes "a stale endpoint.json cannot take the app
// down" checkable, rather than a thing we believe.

const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', '..', 'docs', 'app.js');
const src = fs.readFileSync(APP, 'utf8');

// Lift the resolver out of the shipped file, so the test exercises the code
// that actually loads in the browser rather than a copy.
const start = src.indexOf('const isEphemeralHost');
const end = src.indexOf('// A saved endpoint normally wins');
if (start < 0 || end < 0) throw new Error('endpoint resolver not found in docs/app.js');

const STABLE = 'https://stable.example.ts.net/llm/v1/chat/completions';
let served;               // what endpoint.json returns for this case
const lift = () => {
  const sandbox = {
    fetch: async () => {
      if (served instanceof Error) throw served;
      if (served === null) return { ok: false };
      return { ok: true, json: async () => served };
    },
    Date,
  };
  return eval(
    '(function(fetch, Date){' + src.slice(start, end) +
    '; return {hostedURL, isEphemeralHost}; })'
  )(sandbox.fetch, sandbox.Date);
};

let pass = 0, fail = 0;
function is(actual, expected, label) {
  if (actual === expected) { pass++; return; }
  fail++;
  console.error(`FAIL ${label}\n  expected: ${expected}\n  actual:   ${actual}`);
}

(async () => {
  // The bug, as it happened: a published quick tunnel beat the good fallback.
  served = { url: 'https://lift-should-wondering-batch.trycloudflare.com/v1/chat/completions' };
  is(await lift().hostedURL(STABLE), STABLE,
     'a published quick tunnel is ignored in favour of the stable fallback');

  // A real address published there still wins - the file exists so the model
  // can move without a deploy.
  const moved = 'https://elsewhere.example.ts.net/llm/v1/chat/completions';
  served = { url: moved };
  is(await lift().hostedURL(STABLE), moved,
     'a stable published address still overrides the constant');

  served = new Error('offline');
  is(await lift().hostedURL(STABLE), STABLE, 'fetch failure falls back');

  served = null;
  is(await lift().hostedURL(STABLE), STABLE, 'a 404 on endpoint.json falls back');

  served = { url: 'http://insecure.example.com/v1/chat/completions' };
  is(await lift().hostedURL(STABLE), STABLE, 'a non-https address is refused');

  const { isEphemeralHost } = lift();
  is(isEphemeralHost('https://a-b-c-d.trycloudflare.com/v1/chat/completions'), true,
     'quick tunnels are recognised');
  is(isEphemeralHost('https://patrick-beastmaster.tailf32530.ts.net/llm/v1/chat/completions'), false,
     'the funnel hostname is not ephemeral');

  // What actually ships, right now, in this repo.
  const shipped = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'endpoint.json'), 'utf8'));
  is(isEphemeralHost(shipped.url), false, 'the committed endpoint.json is not a quick tunnel');
  const HOSTED = src.match(/const HOSTED\s*=\s*\{url:"([^"]+)"/);
  if (!HOSTED) throw new Error('HOSTED constant not found in docs/app.js');
  is(isEphemeralHost(HOSTED[1]), false, 'the hardcoded fallback is not a quick tunnel');
  is(new URL(HOSTED[1]).origin, new URL(shipped.url).origin,
     'the fallback and endpoint.json point at the same host');

  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
