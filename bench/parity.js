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
          + slice("const NOT_A_NAME", "async function run(){");

const api = {};
new Function("exports", seg +
  "\nexports.entails=entails;exports.verify=verify;exports.onePerson=onePerson;")(api);

const C = JSON.parse(fs.readFileSync(__dirname + "/parity-cases.json", "utf8"));
const out = { entails: {}, verify: {}, onePerson: {} };
for (const [claim, quote] of C.entails) out.entails[claim + " || " + quote] = api.entails(claim, quote).ok;
for (const q of C.verify) out.verify[q] = api.verify(q, C.verify_text);
for (const [id, text] of Object.entries(C.onePerson)) out.onePerson[id] = api.onePerson(text).ok;
process.stdout.write(JSON.stringify(out, null, 2) + "\n");
