"use strict";
const $=s=>document.querySelector(s);
const LS="ns.settings.v1";
// Default: a bridge fronting a self-hosted Qwen 3.8. Nothing for a visitor to
// configure. Settings exists only for people who want their own model.
// Not the tailnet hostname: on your own tailnet that resolves to a 100.x
// address and Chrome refuses it from a public page. This is public for all.
const HOSTED={url:"https://song-pattern-rice-graham.trycloudflare.com/v1/chat/completions",
              model:"",key:""};

const PRESETS={
  hosted:{url:HOSTED.url,model:HOSTED.model},
  openai:{url:"https://api.openai.com/v1/chat/completions",model:"gpt-4o"},
  anthropic:{url:"https://api.anthropic.com/v1/messages",model:"claude-sonnet-4-5"},
  local:{url:"http://localhost:8080/v1/chat/completions",model:""}};

const SYSTEM=`You read a person's career history and identify the story in it: not a summary of what they did, but the arc underneath it.

You are looking for:
- the throughline: the one thing that stays constant across every move
- departures: what they moved away from, and what that suggests
- pursuits: what they were visibly reaching toward
- the unresolved tension: the open question their next move would answer

Hard rules:
1. Every departure and pursuit must quote VERBATIM text from the profile as its evidence. Copy the characters exactly. Do not paraphrase or tidy the quote. A quote that does not appear word for word will be discarded automatically.
2. If you cannot find verbatim text supporting a claim, omit the claim. An honest short arc beats a well-written invented one.
3. You are inferring about a real person from partial evidence. Prefer the plainer reading.

The throughline and the tension must ALSO cite verbatim text, in the same way. \
They are the two claims a reader will repeat, so they are the two that must \
be anchored. Give one or two exact quotes that make each of them defensible.

Return ONLY JSON:
{"throughline":"one sentence","throughline_evidence":["verbatim quote","verbatim quote"],"unresolved_tension":"one sentence","tension_evidence":["verbatim quote"],"departures":[{"description":"...","evidence":"verbatim quote","confidence":0.0}],"pursuits":[{"description":"...","evidence":"verbatim quote","confidence":0.0}]}

confidence is 0-1 and should reflect genuine doubt.`;

function settings(){ let s={}; try{s=JSON.parse(localStorage.getItem(LS))||{};}catch{}
  if(!s.url) s={...HOSTED};
  return s; }

// ---- the verbatim check, same rule as the CLI -------------------------------
const norm=t=>String(t||"").replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/\s+/g," ").trim();
const canon=t=>norm(t).replace(/^(\.\.\.|…)+|(\.\.\.|…)+$/g,"").replace(/^[\s"'.,;:\-—–]+|[\s"'.,;:\-—–]+$/g,"").toLowerCase();
function verify(ev, raw){ const n=canon(ev); return n.length>=12 && norm(raw).toLowerCase().includes(n); }

// ---- second gate: does the quote SUPPORT the claim, or just sit near it? ----
// Live playtest caught this. The verifier confirmed "Currently working at Odum
// Research where I help building a modern trading platform" and let it stand as
// evidence for "seeking roles that involve building trading infrastructure".
// The quote proves he does it. It says nothing about what he wants. Verifying
// the quote is not verifying the inference, and that gap is where a sourcing
// tool starts inventing motives for real people.
const INTENT=["seeking","seeks","wants to","want to","looking for","looking to",
  "hopes to","hoping to","aims to","aiming to","aspires","is pursuing","intends to",
  "would like to","ready to","eager to","open to"];
const DEPARTURE=["left","leaving","departed","moved away","moved on","stepped away",
  "stepped back","exited","quit","walked away","gave up","abandoned","moved from",
  "transitioned from","shifted from","away from"];
const LEADERSHIP=["lead","leads","leading","led","manage","manages","managing","managed",
  "head of","heads","director","supervis","mentor","hired","reports"];
// A claim that an event caused, affected or upset someone needs a quote that
// speaks that way. Live failure: "the lingering impact of a long, cancelled
// project" cited by a line that only says the project was cancelled.
const CONSEQUENCE=["because","due to","as a result","resulted in","led to","caused",
  "prompted","impact","affect","lingering","legacy of","in the wake of","shaped by",
  "frustrated","burned out","burnt out","demorali","disillusioned","tired of","weary",
  "resent","bitter","scarred","soured","jaded"];
const has=(t,ns)=>{const s=" "+norm(t).toLowerCase()+" ";return ns.some(n=>s.includes(n));};
const nums=t=>new Set((String(t).replace(/,/g,"").match(/\d+/g)||[]));

function entails(claim, quote){
  claim=(claim||"").trim(); quote=(quote||"").trim();
  if(!claim||!quote) return {ok:false,reason:"Nothing to check."};
  if(has(claim,INTENT)&&!has(quote,INTENT))
    return {ok:false,reason:"The quote shows what they do, not what they want."};
  if(has(claim,DEPARTURE)&&!has(quote,DEPARTURE))
    return {ok:false,reason:"The claim says they left something; the quote never mentions leaving."};
  if(has(claim,LEADERSHIP)&&!has(quote,LEADERSHIP))
    return {ok:false,reason:"The claim is about leading people; the quote does not mention it."};
  if(has(claim,CONSEQUENCE)&&!has(quote,CONSEQUENCE))
    return {ok:false,reason:"The claim says the event affected them; the quote only says it happened."};
  const missing=[...nums(claim)].filter(n=>!nums(quote).has(n));
  if(missing.length)
    return {ok:false,reason:`The claim names a figure the quote does not contain: ${missing.join(", ")}.`};
  return {ok:true,reason:""};
}

function score(beats){
  if(!beats.length) return 0;
  const distinct=new Set(beats.map(b=>canon(b.evidence))).size;
  const cover=Math.min(1,distinct/4);
  const mean=beats.reduce((a,b)=>a+b.confidence,0)/beats.length;
  return Math.round(cover*mean*100)/100;
}

// ---- where the hosted model actually is -------------------------------------
// The public address is a Cloudflare quick tunnel, and a quick tunnel gets a
// brand-new random hostname every time cloudflared restarts. The server
// publishes wherever it currently is to endpoint.json beside this file, and a
// timer keeps that current. The constant above is only the fallback for when
// that file is missing.
let RESOLVED_URL = null;
async function hostedURL(fallback){
  if(RESOLVED_URL) return RESOLVED_URL;
  try{
    const r = await fetch("endpoint.json?t=" + Date.now(), {cache:"no-store"});
    if(r.ok){
      const d = await r.json();
      if(d && typeof d.url === "string" && /^https:\/\//.test(d.url)){
        return (RESOLVED_URL = d.url);
      }
    }
  }catch(e){ /* offline, or the file is not there yet - use the fallback */ }
  return (RESOLVED_URL = fallback);
}

// A saved endpoint normally wins: someone chose it in Settings. The exception
// is a saved tunnel address, which was never a choice - just a snapshot of
// where the tunnel happened to be that day. Left alone it would pin whoever
// saved one to a dead host forever, which breaks the app worst for the people
// who opened Settings most.
async function endpointFor(s, fallback){
  if(s.url && !/\.trycloudflare\.com/.test(s.url)) return s.url;
  return await hostedURL(fallback);
}

async function complete(prompt){
  const s=settings();
  const url=await endpointFor(s, HOSTED.url);
  if(!url) throw new Error("Point it at a model first — click Settings.");
  const anth=/anthropic\.com/.test(url);
  const h={"Content-Type":"application/json"}; let body;
  if(anth){ h["x-api-key"]=s.key||""; h["anthropic-version"]="2023-06-01";
    h["anthropic-dangerous-direct-browser-access"]="true";
    body={model:s.model||"claude-sonnet-4-5",max_tokens:4000,system:SYSTEM,messages:[{role:"user",content:prompt}]};
  } else { if(s.key) h.Authorization="Bearer "+s.key;
    body={messages:[{role:"system",content:SYSTEM},{role:"user",content:prompt}],temperature:0.2,max_tokens:8000};
    if(s.model) body.model=s.model; }
  const r=await fetch(url,{method:"POST",headers:h,body:JSON.stringify(body)});
  if(!r.ok) throw new Error(`${r.status} from your endpoint. ${(await r.text()).slice(0,180)}`);
  const d=await r.json();
  if(anth) return (d.content||[]).map(c=>c.text||"").join("");
  const m=d.choices?.[0]?.message||{};
  const t=(m.content||"").replace(/<think>[\s\S]*?<\/think>/gi,"").trim();
  if(!t&&m.reasoning_content) throw new Error("Model returned reasoning but no answer — raise its token limit.");
  return t;
}
function extractJSON(t){ const i=t.indexOf("{"); if(i<0) throw new Error("The model did not return JSON.");
  let d=0,q=false,e=false;
  for(let j=i;j<t.length;j++){const c=t[j];
    if(q){ if(e)e=false; else if(c==="\\")e=true; else if(c==='"')q=false; continue; }
    if(c==='"')q=true; else if(c==="{")d++; else if(c==="}"){d--; if(!d) return JSON.parse(t.slice(i,j+1));}}
  throw new Error("The model's JSON was cut off."); }

async function fromGithub(login){
  const u=await (await fetch(`https://api.github.com/users/${encodeURIComponent(login)}`)).json();
  if(u.message) throw new Error(`GitHub: ${u.message}`);
  const repos=(await (await fetch(`https://api.github.com/users/${encodeURIComponent(login)}/repos?sort=pushed&per_page=12`)).json()).filter(r=>!r.fork);
  const yr=t=>(t||"").slice(0,4)||"?";
  const L=[`${u.name||u.login} (${u.login})`];
  if(u.bio) L.push(`Bio: ${u.bio}`);
  if(u.company) L.push(`Company: ${u.company}`);
  if(u.location) L.push(`Location: ${u.location}`);
  L.push(`On GitHub since ${yr(u.created_at)}. ${u.public_repos} public repositories, ${u.followers} followers.`);
  const langs=[...new Set(repos.map(r=>r.language).filter(Boolean))];
  if(langs.length) L.push(`Languages across recent work: ${langs.join(", ")}.`);
  L.push("", "What they have built, most recently pushed first:");
  repos.forEach(r=>{ const a=yr(r.created_at),b=yr(r.pushed_at);
    L.push(`- ${r.name} (${a===b?a:a+" to "+b})${r.language?", "+r.language:""}${r.stargazers_count?", "+r.stargazers_count+" stars":""}`);
    if(r.description) L.push(`  ${r.description}`); });
  const long=repos.filter(r=>yr(r.created_at)!==yr(r.pushed_at)).map(r=>r.name);
  if(long.length) L.push("", `Projects they came back to across more than one year: ${long.join(", ")}.`);
  return {text:L.join("\n"), name:u.name||u.login};
}

function chips(a,cls){ return `<div class="terms ${cls||""}">`+(a||[]).map(x=>`<span class="term">${esc(x)}</span>`).join("")+"</div>"; }
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

function renderArc(arc, raw, name){
  // The throughline and the tension are the two highest-value inferences in
  // the whole system and neither can be quote-checked directly - they are
  // syntheses, not citations. Left ungrounded, the app will happily render an
  // invented headline over a set of perfectly verified beats and print a
  // reassuring "0 were deleted" underneath it. So they are grounded
  // transitively: they stand only on the claims that survived verification,
  // and when nothing survived, they are labelled unsupported rather than
  // shown as findings.
  const kept = arc.departures.length + arc.pursuits.length;
  const ground = (quotes, what) => {
    if (quotes && quotes.length){
      const q = quotes.map(x=>`<q>${esc(x)}</q>`).join("");
      return `<span class="ground ok">anchored in the profile's own words
                &middot; confidence ${arc.confidence}</span>${q}`;
    }
    return `<span class="ground bad">NOT ANCHORED &mdash; the model could not quote
      anything in the profile that supports this ${what}. Every claim below may
      check out and this line still be invented. Treat it as a guess.</span>`;
  };
  const support = ground(arc.throughline_evidence, "reading");
  const tsupport = ground(arc.tension_evidence, "question");
  const grounded = !!(arc.throughline_evidence && arc.throughline_evidence.length);

  $("#out").innerHTML = `
    <div class="shape${grounded?"":" ungrounded"}"><span class="lbl">Their story in one line</span>
      <p>${esc(arc.throughline)}</p>${support}</div>
    <canvas id="arc"></canvas>
    <div class="arckey">
      <span class="k"><i style="background:#F1580A"></i>the person</span>
      <span class="k"><i style="background:#FF6B57"></i>left behind <b>&larr; left side</b></span>
      <span class="k"><i style="background:#3FE0C4"></i>reaching for <b>right side &rarr;</b></span>
      <span class="k"><i style="background:#3FE0C4"></i><i class="sm" style="background:#3FE0C4"></i>
        <b>big &amp; close</b> = the profile says it plainly &middot;
        <b>small &amp; far</b> = inferred</span>
      <span class="k"><i class="mine"></i>yours, not evidenced</span>
      <span class="hint">hover a node for the quote &middot; click empty space to add one &middot;
        shift-drag to connect &middot; double-click yours to delete</span>
    </div>
    <div class="bar"><span>${arc.departures.length+arc.pursuits.length} claims survived the verbatim check
      &middot; confidence <b>${arc.confidence}</b></span></div>
    <div id="detail" class="detail"><span class="lbl">Click any node</span>
      <p>Every claim here quotes the source word for word. Anything the model could not
      quote was deleted, not flagged.</p></div>
    <div class="cols">
      <div><span class="lbl">What they left</span><div id="deps"></div></div>
      <div><span class="lbl">What they are reaching for</span><div id="purs"></div></div>
    </div>
    <div class="shape tension${(arc.tension_evidence||[]).length?"":" ungrounded"}">
      <span class="lbl">The open question</span>
      <p>${esc(arc.unresolved_tension)}</p>${tsupport}</div>`;
  const beat=b=>`<div class="beat"><div class="bh"><b>${esc(b.description)}</b><span class="pill">${b.confidence}</span></div>
      <q>${esc(b.evidence)}</q></div>`;
  $("#deps").innerHTML = arc.departures.map(beat).join("") || `<p class="none">Nothing they left could be quoted.</p>`;
  $("#purs").innerHTML = arc.pursuits.map(beat).join("") || `<p class="none">Nothing they are reaching for could be quoted.</p>`;
  mountArc($("#arc"), arc, n=>{
    const d=$("#detail");
    if(n.kind==="person"){ d.innerHTML=`<span class="lbl">Their story in one line</span><p>${esc(arc.throughline)}</p>`; return; }
    d.innerHTML=`<span class="lbl">${n.kind==="departure"?"What they left":"What they are reaching for"}
      &middot; confidence ${n.data.confidence}</span><p>${esc(n.data.description)}</p>
      <q>${esc(n.data.evidence)}</q>`;
  });
}

// ---- is this two profiles stacked together? --------------------------------
// The first version counted lines of two to four capitalised words as people's
// names. A LinkedIn export is almost nothing but lines of two to four
// capitalised words - cities, skills, employers, schools, job titles - so it
// fired on every real profile it ever saw, once listing Los Angeles, Brand
// Strategy and Line Producer as three of the people it had found.
//
// It was also quietly biased: its exemption list was senior/staff/lead/
// engineer/developer/manager, so a tech profile's titles were filtered out
// while "Line Producer" and "Studio Liaison" were counted as human beings.
//
// Structure, not names. And it warns rather than refusing: a missed detection
// gives one muddled arc a reader can judge, while a false positive locks
// someone out of the tool over an ordinary profile.
const SECTIONS = ["contact","top skills","skills","experience","education",
  "summary","about","certifications","licenses","honors","publications"];

function onePerson(text){
  if(typeof text !== "string" || !text.trim()) return {ok:true, why:"", evidence:[]};

  const handles = [...new Set((text.match(/linkedin\.com\/in\/[A-Za-z0-9\-_%]+/gi) || [])
    .map(h => h.toLowerCase().replace(/\/$/, "")))];
  if(handles.length >= 2)
    return {ok:false, why:"Two different LinkedIn profiles appear in this text.",
            evidence:handles};

  const emails = [...new Set((text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [])
    .map(e => e.toLowerCase()))];
  if(emails.length >= 2)
    return {ok:false, why:"Two different email addresses appear in this text.",
            evidence:emails};

  const counts = {};
  for(const line of text.split("\n")){
    const bare = line.trim().replace(/:$/, "").toLowerCase();
    if(SECTIONS.includes(bare)) counts[bare] = (counts[bare] || 0) + 1;
  }
  const repeated = Object.keys(counts).filter(k => counts[k] >= 2).sort();
  if(repeated.length >= 2)
    return {ok:false,
            why:"The one-per-profile headings appear twice, which usually means two documents are stacked here.",
            evidence:repeated.map(s => `"${s}" appears more than once`)};

  return {ok:true, why:"", evidence:[]};
}

// ---- the worked example -----------------------------------------------------
// A first-time visitor arrives with nothing to paste and no reason to wait
// twenty seconds for a model on a machine that is not always on. Worse, when
// that machine is off they used to get the browser's own words: "Failed to
// fetch". This is a real saved run - the same input, the same model output -
// replayed through the same gates in the browser, so the numbers it shows are
// computed here and now rather than baked in.
let EXAMPLE = null;
async function loadExample(){
  if(EXAMPLE !== null) return EXAMPLE;
  try{
    const r = await fetch("example.json?t=" + Date.now(), {cache:"no-store"});
    if(r.ok) return (EXAMPLE = await r.json());
  }catch(e){ /* offline, or not published yet */ }
  return (EXAMPLE = false);
}

// The browser's network error is not a sentence anybody should have to read.
function friendly(err){
  const m = String((err && err.message) || err || "");
  if(/failed to fetch|networkerror|load failed|err_/i.test(m))
    return "Could not reach the model — it runs on a machine that is not always on. "
         + "The worked example still works; it needs nothing.";
  return m;
}

async function showExample(){
  const ex = await loadExample();
  if(!ex){ status("The worked example could not be loaded.", 1); return; }
  const data = extractJSON(ex.content);
  // Straight through the real gates - nothing here is precomputed.
  processArc(data, ex.profile, ex.name || "");
  status(statusFor(data, ex.profile) + "  ·  worked example, " + ex.caption);
}

// ---- reading files people drop in -------------------------------------------
// No library: a strict CSP means anything loaded from a CDN never arrives, and
// inlining a PDF engine would be a megabyte of script for one feature. The
// browser already ships the hard part - DecompressionStream does the inflating
// that both .docx and most PDFs need.

async function inflate(bytes, format){
  const ds = new DecompressionStream(format);
  const buf = await new Response(
    new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(buf);
}

// A .docx is a zip. Walk its central directory, pull word/document.xml.
async function readDocx(bytes){
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for(let i = bytes.length - 22; i >= 0 && i > bytes.length - 66000; i--){
    if(dv.getUint32(i, true) === 0x06054b50){ eocd = i; break; }
  }
  if(eocd < 0) throw new Error("that .docx does not look like a valid file");
  let off = dv.getUint32(eocd + 16, true);
  const count = dv.getUint16(eocd + 10, true);
  for(let n = 0; n < count; n++){
    if(dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true);
    const csize  = dv.getUint32(off + 20, true);
    const nlen   = dv.getUint16(off + 28, true);
    const elen   = dv.getUint16(off + 30, true);
    const clen   = dv.getUint16(off + 32, true);
    const lho    = dv.getUint32(off + 42, true);
    const name   = new TextDecoder().decode(bytes.subarray(off + 46, off + 46 + nlen));
    if(name === "word/document.xml"){
      const lnlen = dv.getUint16(lho + 26, true), lelen = dv.getUint16(lho + 28, true);
      const start = lho + 30 + lnlen + lelen;
      const raw = bytes.subarray(start, start + csize);
      const xml = new TextDecoder().decode(method === 8 ? await inflate(raw, "deflate-raw") : raw);
      return xml
        .replace(/<\/w:p>/g, "\n")
        .replace(/<w:tab[^>]*\/>/g, "\t")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/\n{3,}/g, "\n\n").trim();
    }
    off += 46 + nlen + elen + clen;
  }
  throw new Error("could not find the text inside that .docx");
}

// PDFs. Modern ones (Chrome, Word, Pages, LinkedIn) subset their fonts and put
// glyph numbers on the page rather than letters - <0037> Tj means "glyph 55 of
// this subset", not "T". The only way back to text is the font's own ToUnicode
// table, so that gets parsed too. Without it, PDF support would be decoration
// that happens to work on the handful of files still using literal strings.
function pdfEscapes(s){
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (m, g) => {
    if(g === "n" || g === "r") return "\n";
    if(g === "t") return "\t";
    if(g === "b" || g === "f") return " ";
    if(g === "(" || g === ")" || g === "\\") return g;
    return String.fromCharCode(parseInt(g, 8));
  });
}

function hexToText(hex){
  let out = "";
  for(let i = 0; i + 3 < hex.length + 1; i += 4){
    const c = parseInt(hex.slice(i, i + 4), 16);
    if(!isNaN(c) && c) out += String.fromCharCode(c);
  }
  return out;
}

function parseCMap(text){
  const map = new Map();
  let m;
  const bf = /beginbfchar([\s\S]*?)endbfchar/g;
  while((m = bf.exec(text))){
    const pair = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    let g; while((g = pair.exec(m[1]))) map.set(g[1].toLowerCase(), hexToText(g[2]));
  }
  const br = /beginbfrange([\s\S]*?)endbfrange/g;
  while((m = br.exec(text))){
    const body = m[1];
    let g;
    const trip = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
    while((g = trip.exec(body))){
      const lo = parseInt(g[1],16), hi = parseInt(g[2],16), dst = parseInt(g[3],16), w = g[1].length;
      for(let c = lo; c <= hi && c - lo < 65535; c++)
        map.set(c.toString(16).padStart(w,"0").toLowerCase(), String.fromCharCode(dst + (c - lo)));
    }
    const arr = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([\s\S]*?)\]/g;
    while((g = arr.exec(body))){
      const lo = parseInt(g[1],16), w = g[1].length;
      const items = g[3].match(/<[0-9A-Fa-f]+>/g) || [];
      items.forEach((it, i) =>
        map.set((lo + i).toString(16).padStart(w,"0").toLowerCase(), hexToText(it.slice(1,-1))));
    }
  }
  return map;
}

function decodeHex(hex, map){
  if(!map || !map.size) return hexToText(hex);
  const w = [...map.keys()][0].length || 4;
  let out = "";
  for(let i = 0; i < hex.length; i += w){
    const code = hex.slice(i, i + w).toLowerCase();
    out += map.has(code) ? map.get(code) : "";
  }
  return out;
}

// Pull text out of one content stream, switching decoder whenever the page
// switches font.
function pdfTextFrom(str, fontMaps){
  let out = "", cur = null;
  const re = /\/([A-Za-z0-9]+)\s+[\d.]+\s+Tf|\((?:[^()\\]|\\.)*\)\s*Tj|<([0-9A-Fa-f\s]*)>\s*Tj|\[(?:[^\[\]]*)\]\s*TJ|ET|T\*/g;
  let m;
  while((m = re.exec(str))){
    const tok = m[0];
    if(m[1] !== undefined){ cur = fontMaps.get(m[1]) || null; continue; }
    if(tok === "ET" || tok === "T*"){ out += "\n"; continue; }
    if(tok.startsWith("<")){
      out += decodeHex((m[2] || "").replace(/\s/g, ""), cur);
      continue;
    }
    if(tok.startsWith("[")){
      const items = tok.match(/<[0-9A-Fa-f\s]*>|\((?:[^()\\]|\\.)*\)/g) || [];
      for(const it of items){
        out += it.startsWith("<")
          ? decodeHex(it.slice(1,-1).replace(/\s/g,""), cur)
          : pdfEscapes(it.slice(1,-1));
      }
      continue;
    }
    const lit = tok.match(/\((?:[^()\\]|\\.)*\)/);
    if(lit) out += pdfEscapes(lit[0].slice(1,-1)) + "\n";
  }
  return out;
}

// Where the compressed data actually ends. Slicing up to "endstream" leaves
// the newline before it attached, and both Node and the browser reject that as
// trailing junk rather than ignoring it - which is why this silently returned
// nothing until it was traced.
function streamEnd(latin, dict, from, objAt){
  // /Length is either a number or a reference to one. The obvious regex for
  // "a number NOT followed by N R" backtracks: given "/Length 78 0 R" it
  // happily matches "/Length 7" and slices seven bytes out of a twelve
  // thousand byte stream. Every LinkedIn export failed this way, because
  // Apache FOP writes indirect lengths.
  const m = /\/Length\s+(\d+)(\s+(\d+)\s+R)?/.exec(dict);
  if(m && !m[2]) return from + parseInt(m[1], 10);
  if(m && m[2] && objAt){
    const at = objAt.get(m[3]);
    if(at){
      const v = /obj\s*(\d+)/.exec(latin.slice(at[0], at[1]));
      if(v) return from + parseInt(v[1], 10);
    }
  }
  let to = latin.indexOf("endstream", from);
  if(to < 0) return -1;
  while(to > from && /[\r\n \t]/.test(latin[to - 1])) to--;
  return to;
}

async function readPdf(bytes){
  const latin = new TextDecoder("latin1").decode(bytes);

  // Where each indirect object lives, so /ToUnicode 12 0 R can be followed.
  const objAt = new Map();
  const objRe = /(\d+)\s+0\s+obj\b/g;
  let om;
  while((om = objRe.exec(latin))){
    const end = latin.indexOf("endobj", om.index);
    objAt.set(om[1], [om.index, end < 0 ? latin.length : end]);
  }

  const streamOf = async (num) => {
    const at = objAt.get(String(num));
    if(!at) return "";
    const body = latin.slice(at[0], at[1]);
    const sm = /stream\r?\n?/.exec(body);
    if(!sm) return "";
    const from = at[0] + sm.index + sm[0].length;
    const to = streamEnd(latin, body.slice(0, sm.index), from, objAt);
    if(to < 0) return "";
    const raw = bytes.subarray(from, to);
    if(!/\/FlateDecode/.test(body.slice(0, sm.index))) return latin.slice(from, to);
    try { return new TextDecoder("latin1").decode(await inflate(raw, "deflate")); }
    catch(e){ return ""; }
  };

  // /F4 -> font object -> its ToUnicode table.
  const fontObj = new Map();
  const fr = /\/Font\s*<<([\s\S]*?)>>/g;
  let fm;
  while((fm = fr.exec(latin))){
    const pr = /\/([A-Za-z0-9]+)\s+(\d+)\s+0\s+R/g;
    let g; while((g = pr.exec(fm[1]))) fontObj.set(g[1], g[2]);
  }
  const fontMaps = new Map();
  for(const [name, num] of fontObj){
    const at = objAt.get(String(num));
    if(!at) continue;
    const tu = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(latin.slice(at[0], at[1]));
    if(!tu) continue;
    const cmap = await streamOf(tu[1]);
    if(cmap) fontMaps.set(name, parseCMap(cmap));
  }

  let text = "";
  const re = /stream\r?\n?/g;
  let m;
  while((m = re.exec(latin))){
    const head = latin.slice(Math.max(0, m.index - 400), m.index);
    if(/\/Image|\/DCTDecode|\/JPXDecode|\/CCITTFaxDecode|beginbfchar|\/ToUnicode/.test(head)) continue;
    const from = m.index + m[0].length;
    const end = streamEnd(latin, head, from, objAt);
    if(end < 0) continue;
    let body;
    if(/\/FlateDecode/.test(head)){
      try { body = new TextDecoder("latin1").decode(
              await inflate(bytes.subarray(from, end), "deflate")); }
      catch(e){ continue; }
    } else {
      body = latin.slice(from, end);
    }
    if(!/Tj|TJ/.test(body)) continue;
    text += pdfTextFrom(body, fontMaps);
  }
  // Typographic ligatures come back as single characters and would otherwise
  // show up inside quotes as "ﬁnd".
  const LIG = {"\uFB00":"ff","\uFB01":"fi","\uFB02":"fl","\uFB03":"ffi","\uFB04":"ffl","\uFB05":"st","\uFB06":"st"};
  text = text.replace(/[\uFB00-\uFB06]/g, c => LIG[c] || c)
             .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
             .replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n")
             .replace(/\n{3,}/g, "\n\n").trim();
  if(text.replace(/\s/g, "").length < 40)
    throw new Error("no text could be read out of that PDF — if it is a scan, it is a "
                  + "picture of words rather than words, and needs OCR first");
  return text;
}

async function readAnyFile(file){
  const name = (file.name || "").toLowerCase();
  if(/\.(txt|md|markdown|csv|json)$/.test(name) || file.type.startsWith("text/"))
    return (await file.text()).trim();
  const bytes = new Uint8Array(await file.arrayBuffer());
  if(name.endsWith(".docx")) return readDocx(bytes);
  if(name.endsWith(".pdf"))  return readPdf(bytes);
  if(name.endsWith(".doc"))
    throw new Error("old .doc files cannot be read in a browser — save it as .docx or PDF");
  return (await file.text()).trim();   // last resort: treat it as text
}

async function addFiles(files){
  const list = [...files];
  if(!list.length) return;
  status(`Reading ${list.length} file${list.length>1?"s":""}…`);
  const got = [], failed = [];
  for(const f of list){
    try{
      const text = await readAnyFile(f);
      if(text) got.push(text); else failed.push(`${f.name} (it was empty)`);
    }catch(e){ failed.push(`${f.name} — ${e.message}`); }
  }
  if(got.length){
    const box = $("#profile");
    box.value = (box.value.trim() ? box.value.trim() + "\n\n" : "") + got.join("\n\n");
  }
  status(failed.length
    ? `Read ${got.length} of ${list.length}. Could not read: ${failed.join("; ")}`
    : `Read ${got.length} file${got.length>1?"s":""} into the box. Have a look before you run it.`,
    failed.length && !got.length ? 1 : 0);
}

// ---- several sources at once ------------------------------------------------
// Comma separated. GitHub is fetched properly; anything else is attempted and
// named out loud if the site refuses, because a browser cannot read most sites
// and pretending otherwise would be the same sin as an unquoted claim.
function parseSources(raw){
  return String(raw || "").split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
}

function githubLogin(token){
  const m = token.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9-]+)\/?$/i);
  if(m) return m[1];
  if(/^[A-Za-z0-9-]+$/.test(token)) return token;
  return null;
}

async function gatherSources(tokens){
  const texts = [], failures = [];
  let name = "";
  for(const tok of tokens){
    const login = githubLogin(tok);
    try{
      if(login){
        status(`Reading github.com/${login}…`);
        const g = await fromGithub(login);
        texts.push(g.text); name = name || g.name;
      } else {
        status(`Reading ${tok}…`);
        const r = await fetch(tok);
        if(!r.ok) throw new Error(`it answered ${r.status}`);
        const html = await r.text();
        const stripped = html.replace(/<script[\s\S]*?<\/script>/gi, " ")
                             .replace(/<style[\s\S]*?<\/style>/gi, " ")
                             .replace(/<[^>]+>/g, " ")
                             .replace(/\s{2,}/g, " ").trim();
        if(stripped.length < 80) throw new Error("there was no readable text on the page");
        texts.push(stripped);
      }
    }catch(e){
      const why = /failed to fetch|networkerror|load failed/i.test(String(e.message))
        ? "that site does not allow being read by a browser"
        : e.message;
      failures.push(`${tok} — ${why}`);
    }
  }
  return {texts, failures, name};
}

// ---- when things actually happened ------------------------------------------
// Nothing here knew careers happen in an order, and it broke the case this
// tool exists for. A profile with twenty years in film followed by a decade in
// recruiting produced an EMPTY "what they left" section: every departure claim
// died saying "the quote never mentions leaving". The CV never says "I left".
// It proves the departure the way real CVs do - with dates.
//
// LinkedIn exports also print newest first, so document order is the reverse
// of career order. Read top to bottom, a pivot comes out backwards.
const MONTHS = "January|February|March|April|May|June|July|August|September|"
             + "October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec";
// Years however they are dressed. Whatever precedes a year - a month name, an
// 03/, a 3/1/ - is discarded; only the year orders a career.
const PRE = "(?:(?:" + MONTHS + ")\\s+|\\d{1,2}[/.]\\d{1,2}[/.]|\\d{1,2}[/.])?\\s*";
const Y = "(?:19|20)\\d{2}";
const OPEN = "Present|Current|Now|Today|Ongoing";
const RANGE = new RegExp("^[\\s·•\\-–(\\[]*" + PRE + "(" + Y + ")"
  + "\\s*(?:[-–—]|to|until)\\s*" + PRE + "(" + Y + "|" + OPEN + ")[\\s)\\]·•]*$", "i");
const SINCE = new RegExp("^[\\s·•(\\[]*(?:since|from)\\s+" + PRE + "(" + Y + ")[\\s)\\]·•]*$", "i");
const INLINE = new RegExp("^(.{3,90}?)[,;·•\\s]+" + PRE + "(" + Y + ")"
  + "\\s*(?:[-–—]|to|until)\\s*" + PRE + "(" + Y + "|" + OPEN + ")[\\s)\\]·•]*$", "i");
const APOS = /'(\d{2})\b/g;
const tlYear = s => { const n = parseInt(s, 10); return n >= 100 ? n : (n > 40 ? 1900 + n : 2000 + n); };
const tlNormalise = s => s.replace(APOS, (m, y) => String(tlYear(y)));
const NOT_A_LABEL = new Set(["experience","education","certifications","licenses",
  "summary","about","contact","top skills","skills","honors","publications",
  "recommendations","volunteering","projects","languages"]);

function labelFor(lines, i){
  const out = [];
  for(let j = i - 1; j >= 0 && out.length < 2; j--){
    const line = lines[j].replace(/^[\s·•\t]+|[\s·•\t]+$/g, "");
    if(!line){ if(out.length) break; else continue; }
    if(NOT_A_LABEL.has(line.toLowerCase().replace(/:$/, ""))) break;
    if(line.length > 90 || /[.!?]$/.test(line)) break;
    if(RANGE.test(line)) break;
    out.push(line);
  }
  return out.reverse().join(" — ");
}

function extractTimeline(text){
  if(typeof text !== "string" || !text.trim()) return [];
  const lines = text.split("\n");
  const spans = [];
  lines.forEach((line, i) => {
    const bare = tlNormalise(line.trim());
    let m = RANGE.exec(bare);
    if(m){
      const end = /^\d/.test(m[2]) ? tlYear(m[2]) : null;
      const label = labelFor(lines, i);
      if(label) spans.push({label, start: tlYear(m[1]), end, line: i});
      return;
    }
    m = SINCE.exec(bare);
    if(m){
      const label = labelFor(lines, i);
      if(label) spans.push({label, start: tlYear(m[1]), end: null, line: i});
      return;
    }
    m = INLINE.exec(bare);
    if(m){
      const label = m[1].replace(/^[\s,;·•\-–]+|[\s,;·•\-–]+$/g, "");
      if(label && !NOT_A_LABEL.has(label.toLowerCase()))
        spans.push({label, start: tlYear(m[2]),
                    end: /^\d/.test(m[3]) ? tlYear(m[3]) : null, line: i});
    }
  });
  spans.sort((a,b) => (a.start - b.start) || ((a.end ?? 9999) - (b.end ?? 9999)));
  return spans;
}

function timelineSummary(spans){
  if(!spans || !spans.length) return "";
  return spans.map(s => `${s.start}-${s.end === null ? "present" : s.end}: ${s.label}`).join("\n");
}

const TL_WEAK = new Set(["senior","staff","principal","lead","head","chief","director",
  "manager","assistant","associate","consultant","coordinator","specialist","executive",
  "officer","partner","founder","vp","inc","llc","ltd","the","and","for","via","at","of",
  "to","from","into","moved","left","toward","towards","work","working","role","roles",
  "career","job","jobs","then","now","later"]);

function tlWords(text){
  return new Set((String(text||"").toLowerCase().match(/[a-z0-9+#]+/g) || [])
    .filter(w => !TL_WEAK.has(w) && w.length > 2));
}

// A fixed shared-prefix length cannot work: teaching/teacher share five
// characters and nursing/nurse share four, but consulting/construction also
// share four and are unrelated. So: strip one common ending, then a trailing e.
const SUFFIXES = ["ational","ization","isation","ators","ation","ition","ement",
  "ments","ment","ering","ings","ator","ing","ors","ers","ies","ion","ist","or",
  "er","ed","es","s"];
function tlStem(w){
  for(const s of SUFFIXES){
    if(w.endsWith(s) && w.length - s.length >= 3){ w = w.slice(0, -s.length); break; }
  }
  return w.replace(/e+$/, "") || w;
}
function tlSame(a, b){ return a === b || tlStem(a) === tlStem(b); }

function tlMatch(text, spans){
  const tw = [...tlWords(text)];
  return (spans||[]).filter(s => [...tlWords(s.label)].some(a => tw.some(b => tlSame(a,b))));
}

// Which job does this line belong to? By position, not wording: a bullet under
// a job almost never repeats the job title, and matching on shared words
// either misses it or attaches it to a different job sharing a word.
function spanOwning(quote, spans, text){
  if(!text || !quote) return null;
  const at = text.indexOf(String(quote).trim());
  if(at < 0) return null;
  const lineNo = text.slice(0, at).split("\n").length - 1;
  let owner = null;
  for(const s of spans || []){
    if(s.line >= 0 && s.line <= lineNo && (!owner || s.line > owner.line)) owner = s;
  }
  return owner;
}

function provesDeparture(quote, spans, text){
  const owner = spanOwning(quote, spans, text);
  for(const s of (owner ? [owner] : tlMatch(quote, spans))){
    if(s.end === null) continue;
    if((spans||[]).some(o => o !== s && o.start >= s.end)) return true;
  }
  return false;
}

function tlDirection(claim, spans){
  const text = " " + String(claim||"").toLowerCase().replace(/\s+/g," ") + " ";
  const m = /\bfrom\b(.+?)\b(?:to|into|toward|towards)\b(.+)/.exec(text);
  if(!m) return null;
  const before = tlMatch(m[1], spans), after = tlMatch(m[2], spans);
  if(!before.length || !after.length) return null;
  return [Math.min(...before.map(s=>s.start)), Math.min(...after.map(s=>s.start))];
}
function confirmsOrder(claim, spans){ const d = tlDirection(claim, spans); return !!d && d[0] < d[1]; }
function contradictsOrder(claim, spans){ const d = tlDirection(claim, spans); return !!d && d[1] < d[0]; }

async function run(){
  const tokens = parseSources($("#gh").value);
  const pasted = $("#profile").value.trim();
  if(!tokens.length && pasted.length < 80){
    status("Paste a profile, drop a file onto the box, or add a link.", 1); return; }
  $("#run").disabled=true;
  try{
    let name = $("#name").value.trim();
    let parts = pasted ? [pasted] : [];
    let failures = [];
    if(tokens.length){
      // Added to whatever is pasted, never instead of it, and never written
      // back into the box - what you typed stays what you typed.
      const g = await gatherSources(tokens);
      parts = parts.concat(g.texts);
      failures = g.failures;
      name = name || g.name;
    }
    if(!parts.length) throw new Error("Nothing could be read. " + failures.join("; "));
    const raw = parts.join("\n\n");
    const who = onePerson(raw);
    if(!who.ok) failures = failures.concat(
      [`heads up — ${who.why} (${who.evidence.join("; ")})`]);
    status("Reading the arc. This takes as long as your model takes.");
    const chron = timelineSummary(extractTimeline(raw));
    const data=extractJSON(await complete(
      (chron ? `CHRONOLOGY (earliest first — this is the real order, whatever order the document below is in):\n${chron}\n\n` : "")
      + `PROFILE TEXT (quote only from between these markers):\n---BEGIN PROFILE---\n${raw}\n---END PROFILE---`));
    processArc(data, raw, name);
    remember(name || (raw.split("\n").find(l=>l.trim()) || "profile").trim().slice(0,46),
             {arc: LAST_ARC, raw, name});
    status(statusFor(data, raw)
      + (failures.length ? `  ·  ${failures.join("; ")}` : ""));
  }catch(e){ status(friendly(e),1); }
  finally{ $("#run").disabled=false; }
}

let LAST_ARC = null;

function buildArc(data, raw){
    if(!data.throughline) throw new Error("No throughline came back.");
    const unsupported=[];
    const spans = extractTimeline(raw);
    const keep=(arr)=>(arr||[]).filter(b=>{
        if(!b||!b.description||!verify(b.evidence,raw)) return false;
        // The record can say a claim is simply the wrong way round.
        if(spans.length && contradictsOrder(b.description, spans)){
          unsupported.push({d:b.description, why:"The dates in the profile run the other way."});
          return false;
        }
        let v=entails(b.description,b.evidence);
        // A CV proves a departure with dates, not with the word "left".
        if(!v.ok && spans.length && /leaving/.test(v.reason)
           && (provesDeparture(b.evidence, spans, raw) || confirmsOrder(b.description, spans)))
          v = {ok:true, reason:"The record shows this role ended and other work followed."};
        if(!v.ok){ unsupported.push({d:b.description,why:v.reason}); return false; }
        return true;
      })
      .map(b=>({description:b.description,evidence:norm(b.evidence),
                confidence:Math.round(Math.min(Number(b.confidence)||0.5, canon(b.evidence).length>=40?0.9:0.6)*100)/100}));
    const dropped=((data.departures||[]).length+(data.pursuits||[]).length);
    // The headline claims get the identical treatment: quote the source or be
    // struck. A synthesis nobody checked is exactly the thing a reader repeats.
    // Both gates, not one. verify() stops a quote that is not in the profile;
    // entails() stops a quote that IS in the profile but does not back what the
    // headline says. These are the two lines a recruiter repeats out loud.
    const keepQuotes = (arr, claim) => (Array.isArray(arr)?arr:[arr])
      .filter(q => typeof q === "string" && verify(q, raw)
                   && (!claim || entails(claim, q).ok)).map(norm);
    const arc={throughline:data.throughline,unresolved_tension:data.unresolved_tension||"",
               throughline_evidence:keepQuotes(data.throughline_evidence, data.throughline),
               tension_evidence:keepQuotes(data.tension_evidence, data.unresolved_tension||""),
               departures:keep(data.departures),pursuits:keep(data.pursuits)};
    arc.confidence=score([...arc.departures,...arc.pursuits]);
    arc._proposed = dropped; arc._unsupported = unsupported;
    return arc;
}

function processArc(data, raw, name){
  const arc = buildArc(data, raw);
  LAST_ARC = arc;
  renderArc(arc, raw, name);
  return arc;
}

function statusFor(data, raw){
  const arc = LAST_ARC || buildArc(data, raw);
  const kept = arc.departures.length + arc.pursuits.length;
  const un = arc._unsupported.length
    ? ` ${arc._unsupported.length} had a real quote that did not support the claim (${arc._unsupported[0].why})`
    : "";
  return `${kept} of ${arc._proposed} claims survived. ${arc._proposed-kept} deleted.${un}`;
}
function status(m,bad){ const s=$("#status"); s.textContent=m; s.className=bad?"bad":""; }

const HKEY = "ns.history";

// ---- kinematic feel ---------------------------------------------------------
// A synthesized click rather than an audio file: nothing to load, nothing for
// the CSP to block, and it stays in step with the press animation. Two
// transients ~12ms apart read as a switch closing; one alone reads as a beep.
let AC = null;
let SOUND = localStorage.getItem("ui.sound") !== "off";
const QUIET = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function tick(){
  if(!SOUND || QUIET()) return;
  try{
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    if(AC.state === "suspended") AC.resume();
    const t = AC.currentTime;
    for(const [at, freq, gain] of [[0, 1850, 0.055], [0.012, 1120, 0.03]]){
      const o = AC.createOscillator(), g = AC.createGain();
      o.type = "square";
      o.frequency.setValueAtTime(freq, t + at);
      g.gain.setValueAtTime(gain, t + at);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.028);
      o.connect(g); g.connect(AC.destination);
      o.start(t + at); o.stop(t + at + 0.035);
    }
  }catch(e){ /* no audio on this device - the press animation still lands */ }
}

// ---- prior searches ---------------------------------------------------------
// Kept OUT of the input boxes on purpose. Restoring the last run into the form
// meant every new search started by deleting someone else's text.
const HMAX = 8;
function hist(){ try{ return JSON.parse(localStorage.getItem(HKEY)) || []; }catch{ return []; } }
function remember(label, payload){
  const h = hist().filter(e => e.label !== label);
  h.unshift({label, when: Date.now(), payload});
  try{ localStorage.setItem(HKEY, JSON.stringify(h.slice(0, HMAX))); }
  catch(e){ /* quota - drop the oldest and try once */
    try{ localStorage.setItem(HKEY, JSON.stringify(h.slice(0, 3))); }catch(e2){}
  }
  drawRecent();
}
function drawRecent(){
  const box = document.getElementById("recent"); if(!box) return;
  const h = hist();
  box.innerHTML = "";
  box.hidden = !h.length;
  if(!h.length) return;
  const lbl = document.createElement("span");
  lbl.className = "rlbl"; lbl.textContent = "Prior searches";
  box.appendChild(lbl);
  h.forEach(e => {
    const c = document.createElement("button");
    c.type = "button"; c.className = "chip";
    c.textContent = e.label.length > 46 ? e.label.slice(0, 44) + "…" : e.label;
    c.title = "Show this again — your boxes stay as they are";
    c.onclick = () => replay(e);
    box.appendChild(c);
  });
  const clr = document.createElement("button");
  clr.type = "button"; clr.className = "chip clear"; clr.textContent = "Clear";
  clr.onclick = () => { localStorage.removeItem(HKEY); drawRecent();
                        status("Prior searches cleared."); };
  box.appendChild(clr);
}

// One handler for the whole page, so anything button-shaped clicks.
document.addEventListener("pointerdown", e => {
  if(e.target.closest("button, .chip")) tick();
}, true);

function replay(e){
  renderArc(e.payload.arc, e.payload.raw, e.payload.name);
  status("Showing a prior arc. The boxes above are still yours.");
}

window.addEventListener("DOMContentLoaded",()=>{
  $("#run").onclick=run;
  $("#gear").onclick=()=>{const s=settings();$("#url").value=s.url||"";$("#key").value=s.key||"";$("#model").value=s.model||"";$("#settings").showModal();};
  $("#save").onclick=e=>{e.preventDefault();
    localStorage.setItem(LS,JSON.stringify({url:$("#url").value.trim(),key:$("#key").value.trim(),model:$("#model").value.trim()}));
    $("#settings").close(); status("Endpoint saved. It stays in this browser.");};
  document.querySelectorAll("[data-preset]").forEach(b=>b.onclick=e=>{e.preventDefault();
    const p=PRESETS[b.dataset.preset]; $("#url").value=p.url; $("#model").value=p.model;});
  $("#demo").onclick = showExample;

  // Drop a file anywhere on the box. dragover must be cancelled or the browser
  // navigates away to the file instead, which loses whatever was typed.
  const drop = document.getElementById("droplabel");
  const mark = on => drop.classList.toggle("drag", on);
  ["dragenter","dragover"].forEach(e => drop.addEventListener(e, ev => {
    ev.preventDefault(); ev.stopPropagation(); mark(true); }));
  ["dragleave","dragend"].forEach(e => drop.addEventListener(e, ev => {
    ev.preventDefault(); if(ev.target === drop || !drop.contains(ev.relatedTarget)) mark(false); }));
  drop.addEventListener("drop", ev => {
    ev.preventDefault(); ev.stopPropagation(); mark(false);
    if(ev.dataTransfer && ev.dataTransfer.files.length) addFiles(ev.dataTransfer.files);
  });
  // A file dropped anywhere else would otherwise replace the whole page.
  ["dragover","drop"].forEach(e => window.addEventListener(e, ev => {
    if(!drop.contains(ev.target)) ev.preventDefault(); }));
  $("#pick").onclick = e => { e.preventDefault(); $("#file").click(); };
  $("#file").onchange = e => { addFiles(e.target.files); e.target.value = ""; };
  drawRecent();
  status("Ready. Give it a GitHub username, or paste a profile.");
  // A first-time visitor arrives with nothing to paste. Show them a real run
  // rather than an empty page - it needs no model and no waiting.
  if(!hist().length) showExample();
});
