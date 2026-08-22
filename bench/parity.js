// Do the JavaScript ports still agree with the Python they were copied from?
//
// The deployed page runs its own copy of these gates. Once already a fix
// landed in Python and never reached docs/app.js; the live page stayed wrong
// for hours with every test green. bench/run.py compares this output to
// Python's and fails when they disagree.
const fs = require("fs");
const src = fs.readFileSync(__dirname + "/../docs/app.js", "utf8");

function slice(from, to) {
  const a = src.indexOf(from), b = src.indexOf(to);
  if (a < 0 || b < 0 || b <= a) throw new Error(`cannot slice ${from} .. ${to}`);
  return src.slice(a, b);
}
const seg = slice("const norm=", "function extractJSON")
          + slice("const SECTIONS", "// ---- the worked example")
          + slice("const MONTHS", "async function run(){");

const api = {};
new Function("exports", seg +
  "\nexports.entails=entails;exports.verify=verify;exports.onePerson=onePerson;"
  + "exports.extractTimeline=extractTimeline;exports.timelineSummary=timelineSummary;"
  + "exports.provesDeparture=provesDeparture;exports.confirmsOrder=confirmsOrder;"
  + "exports.contradictsOrder=contradictsOrder;exports.tlSame=tlSame;")(api);

const C = JSON.parse(fs.readFileSync(__dirname + "/parity-cases.json", "utf8"));
const out = { entails: {}, verify: {}, onePerson: {}, timeline: {} };
for (const [claim, quote] of C.entails) out.entails[claim + " || " + quote] = api.entails(claim, quote).ok;
for (const q of C.verify) out.verify[q] = api.verify(q, C.verify_text);
for (const [id, text] of Object.entries(C.onePerson)) out.onePerson[id] = api.onePerson(text).ok;
const spans = api.extractTimeline(C.timeline_text);
out.timeline = { summary: api.timelineSummary(spans) };
for (const q of C.timeline.proves_departure) out.timeline["dep:" + q] = api.provesDeparture(q, spans);
for (const q of C.timeline.contradicts) out.timeline["con:" + q] = api.contradictsOrder(q, spans);
for (const q of C.timeline.confirms) out.timeline["cfm:" + q] = api.confirmsOrder(q, spans);
for (const [a, b] of C.timeline.same_word) out.timeline["same:" + a + "/" + b] = api.tlSame(a, b);
for (const [id, cv] of Object.entries(C.timeline.formats)) {
  const s = api.extractTimeline(cv);
  out.timeline["fmt:" + id] = s.length ? [s[0].start, s[0].end] : null;
}
const ow = C.timeline.owning;
for (const q of ow.quotes)
  out.timeline["own:" + q] = api.provesDeparture(q, api.extractTimeline(ow.text), ow.text);
process.stdout.write(JSON.stringify(out, null, 2) + "\n");
