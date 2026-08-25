// Runs the browser's own file reader outside the browser.
//
// docs/app.js parses PDFs itself, and nothing tested it: the indirect /Length
// fix landed once, was lost to an edit, landed again, and then a LinkedIn
// export still came out as glyph numbers because a different line truncated
// the stream by one byte. Slicing the reader out of the shipped file - the
// same trick bench/parity.js uses for the gates - means the tests read the
// code that actually runs.
const fs = require("fs");
const src = fs.readFileSync(__dirname + "/../docs/app.js", "utf8");
const a = src.indexOf("// ---- reading files people drop in");
const b = src.indexOf("// ---- several sources at once");
if (a < 0 || b <= a) throw new Error("cannot find the file-reading block in docs/app.js");

const api = {};
new Function("exports", src.slice(a, b) + "\nexports.readAnyFile=readAnyFile;")(api);

(async () => {
  const path = process.argv[2];
  const file = new File([fs.readFileSync(path)], path.split("/").pop());
  try {
    process.stdout.write("OK\n" + (await api.readAnyFile(file)));
  } catch (e) {
    process.stdout.write("REFUSED\n" + e.message);
  }
})();
