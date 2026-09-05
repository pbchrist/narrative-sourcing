// Regression tests for the LinkedIn page-paste path.
//
// A real Cmd-A copy of a live LinkedIn profile was cited as the candidate's
// own self-narrative:
//
//   "My brilliant VP of Engineering Joshua Leven is recruiting for a host of
//    roles"
//
// That is his CEO writing about him. It passed the verbatim check because the
// sentence genuinely appears in the pasted text -- a verifiable false
// attribution, which src/intake/linkedin.py exists to prevent for PDF exports
// and which the web app had no defence against at all.
//
// Run: node tests/js/linkedin_paste.test.js
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "../../docs/app.js"), "utf8");

function lift(startMarker, endMarker){
  const a = src.indexOf(startMarker);
  const b = src.indexOf(endMarker, a);
  if(a < 0 || b < 0) throw new Error("could not lift " + startMarker);
  return src.slice(a, b);
}
function liftFn(name){
  const a = src.indexOf("function " + name + "(");
  let depth = 0, i = src.indexOf("{", a), end = i;
  for(; i < src.length; i++){
    if(src[i] === "{") depth++;
    else if(src[i] === "}"){ depth--; if(!depth){ end = i + 1; break; } }
  }
  return src.slice(a, end);
}

const HEADINGS = new Set(["experience","education","about","summary","skills"]);
const SIDEBAR = new Set(["top skills","skills","languages","certifications"]);
const LOOKS_LIKE_A_PLACE = /,\s*(united states|usa|uk|canada|india)|area$|metropolitan/i;
eval(lift("const LI_CUT_FROM", "function guessName("));
eval(liftFn("guessName"));

let failures = 0;
function check(label, actual, expected){
  const ok = actual === expected;
  if(!ok) failures++;
  console.log((ok ? "ok   " : "FAIL ") + label +
    (ok ? "" : `\n       expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`));
}

const PAGE = [
  "0 notifications","Skip to search","Home","My Network","Jobs","Messaging",
  "Notifications","Me","For Business","Advertise","","Joshua Leven","","· 2nd","",
  "Startup Engineering Leader | Founder","","San Francisco, California, United States",
  "","Contact info","","500+","","connections","","John is a mutual connection","",
  "Connect","Message","Activity","","1,314 followers","","Follow","Posts","Comments","",
  "Joshua Leven","","5d • ","",
  "Huge day for our team at Probably Genetic, and for all those living with a rare disease!","",
  "Probably Genetic reposted this","",
  "My brilliant VP of Engineering Joshua Leven is recruiting for a host of roles.","",
  "Joshua Leven","","Experience","VP of Engineering","Probably Genetic · Full-time",
  "Jun 2026 - Present · 4 mos",
  "Shortening the diagnostic journey for the 400M people with a rare genetic disease.","",
  "More profiles for you","Lisa Devashrayee-Oaks, MBA","· 2nd","Revenue-focused product marketing",
  "Accessibility","Talent Solutions","LinkedIn Corporation © 2026","Select language",
  "العربية (Arabic)",
].join("\n");

const out = stripLinkedInFurniture(PAGE, "Joshua Leven").text;

check("drops a colleague's post about the candidate",
  /brilliant VP of Engineering/i.test(out), false);
check("drops other people from 'More profiles for you'",
  /Lisa Devashrayee/i.test(out), false);
check("drops global nav", /My Network|Skip to search/i.test(out), false);
check("drops the footer", /Talent Solutions|LinkedIn Corporation/i.test(out), false);
check("drops the language picker", /\(Arabic\)/.test(out), false);
check("drops connection and follower counts",
  /1,314 followers|500\+|^connections$/m.test(out), false);
check("KEEPS the candidate's own post",
  /Huge day for our team/i.test(out), true);
check("KEEPS the candidate's own role description",
  /Shortening the diagnostic journey/i.test(out), true);
check("KEEPS the experience block", /VP of Engineering/i.test(out), true);
check("KEEPS the headline", /Startup Engineering Leader/i.test(out), true);

// A resume is not a LinkedIn page and must pass through untouched.
const RESUME = "Riley Chen\nSenior Platform Engineer\nSeattle, Washington\n\nExperience\nStripe\nLed the migration off a shared monolith.";
check("leaves a pasted resume alone",
  stripLinkedInFurniture(RESUME, "Riley Chen").text, RESUME);

// Never strip a page down to nothing: wrong patterns must fail safe.
const ODD = "0 notifications\nMy Network\n" + "Some genuinely long prose about a career. ".repeat(20);
check("falls back to raw text rather than gutting the input",
  stripLinkedInFurniture(ODD, "").text.length > 400, true);

// Name detection.
check("finds the name on a LinkedIn paste", guessName(PAGE, ""), "Joshua Leven");
check("returns nothing rather than an employer on a bare experience list",
  guessName("Experience\nMarketplace Accelerator\nDirector of Marketing\nFeb 2023 - Mar 2024", ""), "");
check("still finds a name on a resume", guessName(RESUME, ""), "Riley Chen");

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
