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

// ---- is this one person? ---------------------------------------------------
// Every other gate asks whether a claim is supported by the text. None asks
// whether the text is about a single human being. A live run pasted two
// profiles together and produced a confident arc for someone who does not
// exist - keeping one person, silently dropping the other, every quote
// verbatim-correct. Nothing was fabricated, so nothing downstream caught it.
const NOT_A_NAME = new Set(["senior","staff","principal","lead","head","chief",
  "director","manager","engineer","developer","analyst","specialist","consultant",
  "experience","education","skills","summary","about","projects","work",
  "employment","history","contact","profile","recommendations","certifications",
  "languages","interests","volunteering","publications","software","technical",
  "professional","current","previous"]);

function nameHeader(line){
  const head = String(line).trim().split(/\s+[-–—|]\s+|,/)[0].trim();
  if(!head || /\d/.test(head)) return null;
  const words = head.split(/\s+/);
  if(words.length < 2 || words.length > 4) return null;
  for(const w of words){
    const bare = w.replace(/[.'’]+$/,"").replace(/^[.'’]+/,"");
    if(!bare || bare[0] !== bare[0].toUpperCase() || bare[0] === bare[0].toLowerCase()) return null;
    if(NOT_A_NAME.has(bare.toLowerCase())) return null;
    if(!/^[A-Za-z][A-Za-z.'’-]*$/.test(bare)) return null;
  }
  return head;
}

// Deliberately narrow: two or more distinct name headers. Two concurrent
// employers is NOT used - people genuinely hold an advisory role alongside a
// job, and accusing them of being two people over it is worse than the failure
// this prevents.
function onePerson(text){
  if(typeof text !== "string" || !text.trim()) return {ok:true, names:[]};
  const names=[], seen=new Set();
  for(const line of text.split("\n")){
    const got = nameHeader(line);
    if(got && !seen.has(got.toLowerCase())){ seen.add(got.toLowerCase()); names.push(got); }
  }
  return names.length < 2 ? {ok:true, names:[]} : {ok:false, names};
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

async function run(){
  const gh=$("#gh").value.trim(), pasted=$("#profile").value.trim();
  if(!gh && pasted.length<80){ status("Paste a profile, or give me a GitHub username.",1); return; }
  $("#run").disabled=true;
  try{
    let raw=pasted, name=$("#name").value.trim();
    if(gh){ status(`Reading github.com/${gh}…`); const g=await fromGithub(gh); raw=g.text; name=name||g.name; $("#profile").value=raw; }
    const who = onePerson(raw);
    if(!who.ok) throw new Error(
      "This looks like more than one person's profile pasted together — found "
      + who.names.join(" and ") + ". An arc drawn across two careers is not a "
      + "career, and this would quietly keep one of them and drop the other.");
    status("Reading the arc. This takes as long as your model takes.");
    const data=extractJSON(await complete(`PROFILE TEXT (quote only from between these markers):\n---BEGIN PROFILE---\n${raw}\n---END PROFILE---`));
    processArc(data, raw, name);
    remember(name || (raw.split("\n").find(l=>l.trim()) || "profile").trim().slice(0,46),
             {arc: LAST_ARC, raw, name});
    status(statusFor(data, raw));
  }catch(e){ status(friendly(e),1); }
  finally{ $("#run").disabled=false; }
}

let LAST_ARC = null;

function buildArc(data, raw){
    if(!data.throughline) throw new Error("No throughline came back.");
    const unsupported=[];
    const keep=(arr)=>(arr||[]).filter(b=>{
        if(!b||!b.description||!verify(b.evidence,raw)) return false;
        const v=entails(b.description,b.evidence);
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
  drawRecent();
  status("Ready. Give it a GitHub username, or paste a profile.");
  // A first-time visitor arrives with nothing to paste. Show them a real run
  // rather than an empty page - it needs no model and no waiting.
  if(!hist().length) showExample();
});
