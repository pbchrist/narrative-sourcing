// The no-sendable-text guard, as it ships in the browser.
//
// docs/index.html promises "It is raw material for a recruiter. The message
// stays human." That rule was enforced in src/brief/guard.py and nowhere in
// docs/app.js, so nothing stopped a chatty model from putting a ready-to-send
// message on the page and into the copied brief. These assertions are the
// thing that makes the promise checkable.

const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', '..', 'docs', 'app.js');
const src = fs.readFileSync(APP, 'utf8');

// Lift scanSendable and the pattern table out of the shipped file, so the test
// exercises the code that actually loads in the browser rather than a copy.
const start = src.indexOf('const SENDABLE = [');
const end = src.indexOf('function buildArc(');
if (start < 0 || end < 0) throw new Error('guard not found in docs/app.js');
const scanSendable = eval(
  '(function(){' + src.slice(start, end) + '; return scanSendable; })()'
);

let pass = 0, fail = 0;
function is(actual, expected, label) {
  const ok = actual === expected;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}` +
    (ok ? '' : `\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));
}
const trips = (text, label, exempt) =>
  is(scanSendable(text, exempt) !== null, true, label);
const clean = (text, label, exempt) =>
  is(scanSendable(text, exempt), null, label);

// --- text the tool must never author ---------------------------------------
trips('Hi Jared, I came across your profile and wanted to reach out.', 'salutation + opener');
trips('Hey Sarah, quick question about your work.', 'salutation, mid-sentence');
trips('Dear Michael,\nYour background stood out.', 'formal salutation');
trips("I'd love to connect about the platform work.", 'first-person pitch');
trips('I would love to chat about what you built at Stripe.', 'pitch, unabbreviated');
trips('Would you be open to a conversation?', 'second-person question');
trips('Are you looking for something new?', 'second-person question, present');
trips('Let me know if you want to talk.', 'second-person close');
trips("I'm reaching out because of your infrastructure work.", 'outreach opener');
trips('I am reaching out about a staff role.', 'outreach opener, unabbreviated');
trips('Thanks for your time.\n\nBest regards\nPatrick', 'sign-off');
trips('Sounds good.\n\nCheers,\nP', 'comma sign-off before newline');

// --- analysis about a person, which must pass untouched --------------------
clean('He left agency work for in-house product after eight years.', 'plain analysis');
clean('She is reaching for scope she has not had before.', 'third-person "reaching", not the opener');
clean('Worth checking what happened at Acme before reaching out.',
      'a caution to the recruiter is analysis, not a message');
clean('The profile is silent on why the 2021 role ended.', 'an absence, stated');
clean('Their pursuits and departures both point at the same unresolved question.',
      'ordinary vocabulary of the tool');

// --- the exemption guard.py's docstring warns about ------------------------
// A candidate who writes "I'd love to connect" in their own About section has
// done nothing wrong. Striking that would police their prose instead of ours.
const own = "I'd love to connect with people building in climate.";
trips(own, 'candidate phrasing trips the guard with no exemption');
clean(own, 'the same span, exempt as a verified quote', [own]);
clean(`They describe themselves this way: "${own}"`,
      'analysis wrapped around an exempt quote stays clean', [own]);
trips(`${own} Would you be open to a call?`,
      'prose around an exempt quote is still scanned', [own]);

// --- degenerate input -------------------------------------------------------
clean('', 'empty string');
clean(null, 'null');
clean(undefined, 'undefined');
clean('   \n\t ', 'whitespace');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
