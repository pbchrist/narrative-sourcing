"use strict";
const $=s=>document.querySelector(s);
const LS="ns.settings.v1";
// Default: a bridge fronting a self-hosted Qwen 3.8. Nothing for a visitor to
// configure. Settings exists only for people who want their own model.
// Not the tailnet hostname: on your own tailnet that resolves to a 100.x
// address and Chrome refuses it from a public page. This is public for all.
// Stable Tailscale Funnel hostname. This used to be a trycloudflare quick tunnel,
// which gets a random name and dies on restart -- so this constant went stale
// within days and became the dead fallback behind a stale endpoint.json. Both
// have to point somewhere real, not just the JSON.
const HOSTED={url:"https://patrick-beastmaster.tailf32530.ts.net/llm/v1/chat/completions",
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

Be thorough. A full career history contains many moves, not two. Work through
the profile from the earliest entry to the latest and account for all of it:
every change of employer, every change of title, every change in the kind of
problem they took on, every subject they picked up and every one they put down.
A twenty-year history should yield something like six to twelve departures and
six to twelve pursuits. Return every one the text can support. Do not stop at
the obvious ones, and do not merge several distinct moves into one summary
claim - separate moves are separate entries.

Hard rules:
1. Every departure and pursuit must quote VERBATIM text from the profile as its evidence. Copy the characters exactly. Do not paraphrase or tidy the quote. A quote that does not appear word for word will be discarded automatically.
1a. The quote must carry the claim, not merely sit near it. These are checked
mechanically and a claim whose quote fails is deleted without appeal:
   - If the claim says they LEFT or moved away from something, the quote has to
     say so too. A quote showing only what they did there proves they did it,
     not that they went. Quote the dates that closed the role, or the line that
     names the move.
   - If the claim says they WANT or are reaching for something, the quote has to
     express intent. What they currently do is not what they are seeking.
   - If the claim is about LEADING people, the quote has to mention leading,
     managing, mentoring or hiring.
   - If the claim says an event affected them, the quote has to say something
     about the effect, not just that the event happened.
   - Any number in the claim has to appear in the quote.
Pick the quote that satisfies the rule. If no such quote exists, drop the claim
and write a different one that your quote does support.
2. If you cannot find verbatim text supporting a claim, omit the claim. An honest short arc beats a well-written invented one.
3. You are inferring about a real person from partial evidence. Prefer the plainer reading.

The throughline and the tension must ALSO cite verbatim text, in the same way. \
They are the two claims a reader will repeat, so they are the two that must \
be anchored. Give one or two exact quotes that make each of them defensible.

Return ONLY JSON:
{"throughline":"one sentence","throughline_evidence":["verbatim quote","verbatim quote"],"unresolved_tension":"one sentence","tension_evidence":["verbatim quote"],"departures":[{"description":"...","evidence":"verbatim quote","confidence":0.0}],"pursuits":[{"description":"...","evidence":"verbatim quote","confidence":0.0}]}

confidence is 0-1 and should reflect genuine doubt.`;

// What one request is allowed to weigh, system prompt included. The 24,000
// this used to be was measured against a tunnel that turned out to front a
// different service entirely; the model behind the real one carries a 131,072
// token context, and a résumé that had to be truncated to fit six thousand
// tokens was being cut for no reason at all. What is left is a backstop
// against pasting an entire book, not a budget.
const CAP = 120000;
const OWN_CAP = 400000;

// The endpoint measures the body that arrives, not the text that was typed,
// and JSON encoding is not free - a newline costs two characters, a control
// character costs six, and an emoji costs four bytes. That first pair is how a
// nineteen thousand character file became a hundred thousand byte request.
const BYTES = new TextEncoder();
const weigh = t => BYTES.encode(JSON.stringify(String(t == null ? "" : t))).length;

// The longest opening stretch of `text` that still fits `room` once encoded,
// pulled back to a line break so the text never stops mid-sentence.
function fitTo(text, room){
  if(weigh(text) <= room) return text;
  let keep = Math.min(text.length, room);
  for(let i = 0; i < 8 && keep > 0 && weigh(text.slice(0, keep)) > room; i++)
    keep = Math.floor(keep * room / weigh(text.slice(0, keep))) - 8;
  keep = Math.max(0, keep);
  const brk = text.lastIndexOf("\n", keep);
  return text.slice(0, brk > keep - 400 ? brk : keep);
}

// Nobody's model is the default any more, least of all mine.
//
// The box behind the hosted address is two consumer GPUs in a house, serving
// one request at a time at roughly a minute each. That is fine for one person
// and it is a smoking crater the moment this page is in front of a crowd:
// visitor two waits a minute, visitor fifty waits an hour, and an open
// inference endpoint is an invitation to spend somebody else's electricity.
//
// It is also the wrong shape for what this argues. The claim is that a
// recruiter should not hand candidates to a service and trust what comes
// back. Running a service that reads candidates would contradict it. So the
// page ships the part that proves the rule - the worked example and the
// ablation - with no model at all, and the live read runs against whatever
// endpoint the person at the keyboard chose.
function settings(){ let s={}; try{s=JSON.parse(localStorage.getItem(LS))||{};}catch{}
  return s; }
const configured = () => !!(settings().url || HOSTED.url);

// ---- the verbatim check, same rule as the CLI -------------------------------
const norm=t=>String(t||"").replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/\s+/g," ").trim();
const canon=t=>norm(t).replace(/^(\.\.\.|…)+|(\.\.\.|…)+$/g,"").replace(/^[\s"'.,;:\-—–]+|[\s"'.,;:\-—–]+$/g,"").toLowerCase();
function verify(ev, raw){ const n=canon(ev); return n.length>=12 && norm(raw).toLowerCase().includes(n); }

// The model was told to copy and very nearly did - tidied a comma, dropped a
// word, ran two lines of the profile together. The quote then fails the
// verbatim check and a perfectly good claim is deleted, even though the
// profile plainly contains the sentence it was reaching for. A smaller model
// does this constantly: on one run thirty-seven claims came back and two
// survived.
//
// The answer is not to loosen the check. It is to shorten the quote to the
// longest run of its own words that IS in the source, character for
// character, and let the unchanged check pass judgement on that. Nothing is
// invented and nothing is stretched: what comes back is always a literal
// substring of the profile, and always shorter than what the model claimed.
// If too little of it survives, the claim still dies.
// Matching has to ignore what the model tidied - a hyphen turned into a space,
// a comma added, a stray bracket - while what comes back has to be the
// profile's own characters. So both sides are flattened to letters, digits and
// single spaces, with a map from every flattened position back to where it
// came from, and the answer is cut out of the original using that map.
function loosen(text){
  const s = norm(text);
  let out = "", map = [], space = true;
  for(let i = 0; i < s.length; i++){
    const c = s[i].toLowerCase();
    if(/[a-z0-9]/.test(c)){ out += c; map.push(i); space = false; }
    else if(!space){ out += " "; map.push(i); space = true; }
  }
  while(out.endsWith(" ")){ out = out.slice(0, -1); map.pop(); }
  return {s, out, map};
}

function snap(quote, raw){
  if(verify(quote, raw)) return quote;
  const H = loosen(raw), Q = loosen(quote);
  const words = Q.out.split(" ").filter(Boolean);
  if(words.length < 3) return null;
  const padded = " " + H.out + " ";
  let best = "", at = -1;
  for(let i = 0; i < words.length; i++){
    for(let j = words.length; j > i; j--){
      const run = words.slice(i, j).join(" ");
      if(run.length <= best.length) break;       // cannot beat what we have
      const k = padded.indexOf(" " + run + " "); // whole words only
      if(k >= 0){ best = run; at = k; break; }
    }
  }
  // Long enough to mean something, and most of what was claimed. A fragment
  // rescued out of a quote that was largely invented is not evidence.
  if(!best || best.length < 24 || best.length < Q.out.length * 0.55) return null;
  const from = H.map[at], to = H.map[at + best.length - 1];
  return H.s.slice(from, to + 1);              // the source's own characters
}

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
// A CV says someone left in more ways than this list first allowed. "I stopped
// working on dashboards" is a departure stated outright, and the gate deleted
// the claim attached to it for never mentioning leaving - a false negative that
// quietly threw away sound claims all day. All of these state the ending
// rather than merely implying it.
const DEPARTURE=["left","leaving","departed","moved away","moved on","stepped away",
  "stepped back","exited","quit","walked away","gave up","abandoned","moved from",
  "transitioned from","shifted from","away from",
  "stopped","no longer","ceased","wound down","handed off","handed over",
  "gave notice","resigned","retired from","closed out","wrapped up",
  "stepped down","parted ways","switched from","pivoted from",
  "before moving","until","formerly","previously"];
// What makes a CLAIM one about leading is not what makes a QUOTE prove it.
// "Pursued a career in film, starting with assisting a director" contains
// "director" and is not a claim about leading anyone - the title belongs to
// somebody else and the subject is the assistant. Trigger on what the subject
// is said to DO; accept a bare title as proof only on the quote side.
const LEADS_CLAIM=["led ","leads ","leading ","leadership","manage","manages",
  "managing","managed","head of","heads ","supervis","mentor","hired",
  "hiring manager","built a team","grew the team","direct reports"];
// Every way a quote can SHOW leadership, including each way a claim can assert
// it - a quote saying the very words the claim used has to be able to prove it.
const LEADERSHIP=["lead","leads","leading","led","leadership","manage","manages",
  "managing","managed","head of","heads","director","supervis","mentor","hired",
  "reports","built a team","grew the team","team of","direct reports","hiring manager"];
// A claim that an event caused, affected or upset someone needs a quote that
// speaks that way. Live failure: "the lingering impact of a long, cancelled
// project" cited by a line that only says the project was cancelled.
const CONSEQUENCE=["because","due to","as a result","resulted in","led to","caused",
  // "impact" and "affect" bare caught "documentary content with social
  // impact", which names a subject rather than an effect on anyone.
  "prompted","impact on","impacted","impact of","affected","affects",
  "lingering","legacy of","in the wake of","shaped by",
  "frustrated","burned out","burnt out","demorali","disillusioned","tired of","weary",
  "resent","bitter","scarred","soured","jaded"];
const has=(t,ns)=>{const s=" "+norm(t).toLowerCase()+" ";return ns.some(n=>s.includes(n));};
const nums=t=>new Set((String(t).replace(/,/g,"").match(/\d+/g)||[]));

const FROM_TO=/\bfrom\b(.{2,80}?)\b(?:to|into|toward|towards)\b/i;
function directional(claim){
  const m=FROM_TO.exec(" "+norm(claim)+" ");
  // "grew the team from 3 to 12" and "from 2019 to 2022" measure rather than
  // move. A number on either side means it is a range, not a departure.
  return !!m && !/\d/.test(m[0]);
}

function entails(claim, quote){
  claim=(claim||"").trim(); quote=(quote||"").trim();
  if(!claim||!quote) return {ok:false,reason:"Nothing to check."};
  if(has(claim,INTENT)&&!has(quote,INTENT))
    return {ok:false,reason:"The quote shows what they do, not what they want."};
  // "Shifting focus from general tech to healthcare" is a departure claim
  // naming no departure verb, and it slipped the gate entirely while a quote
  // about a current focus stood as proof of leaving. A claim shaped "from X to
  // Y" asserts the move whatever verb it reaches for.
  if((has(claim,DEPARTURE)||directional(claim))&&!has(quote,DEPARTURE))
    return {ok:false,reason:"The claim says they left something; the quote never mentions leaving."};
  if(has(claim,LEADS_CLAIM)&&!has(quote,LEADERSHIP))
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
  // A saved endpoint wins, except when it pins a host that is known to rotate
  // away. trycloudflare names are ephemeral; anyone who saved one in Settings
  // is pinned to a dead host forever, which breaks the app worst for the people
  // who opened Settings most.
  if(s.url && !/\.trycloudflare\.com/.test(s.url)) return s.url;
  return await hostedURL(fallback);
}

async function complete(prompt){
  const s=settings();
  const url=await endpointFor(s, HOSTED.url);
  if(!url) throw new Error("No model is set up — open Settings and point this at one.");
  if(!url) throw new Error("Point it at a model first — click Settings.");
  const anth=/anthropic\.com/.test(url);
  const h={"Content-Type":"application/json"}; let body;
  if(anth){ h["x-api-key"]=s.key||""; h["anthropic-version"]="2023-06-01";
    h["anthropic-dangerous-direct-browser-access"]="true";
    body={model:s.model||"claude-sonnet-4-5",max_tokens:4000,system:SYSTEM,messages:[{role:"user",content:prompt}]};
  } else { if(s.key) h.Authorization="Bearer "+s.key;
    // Same profile, same answer. At 0.2 the same résumé produced three
    // surviving claims one minute and four the next, one of them a departure
    // the other run never proposed - and a recruiter cannot be handed two
    // different careers for the same person and told both were evidenced.
    // seed is honoured by llama.cpp and ignored by everyone else.
    body={messages:[{role:"system",content:SYSTEM},{role:"user",content:prompt}],
          temperature:0,top_p:1,seed:7,max_tokens:8000};
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

// The deleted claims, with the sentence the model offered and the reason it
// was not good enough. This is the only part of the page that shows the tool
// failing, which is exactly why it belongs on the page: a deletion counter
// asks to be trusted, and a list of what was deleted does not have to be.
function rejects(list){
  if(!list || !list.length) return "";
  const rows = list.map(u => `<div class="beat reject">
      <div class="bh"><b>${esc(u.d)}</b><span class="pill">deleted</span></div>
      ${u.q ? `<q>${esc(u.q)}</q>` : ""}
      <span class="why">${esc(u.why)}</span>
    </div>`).join("");
  return `<details class="shown-rejects"><summary>${list.length}
      claim${list.length>1?"s were":" was"} deleted &mdash; see them and why</summary>
    <p class="none">These are the model's own words, thrown away by the checks rather than
      shown to you as findings. Every tool in this category will show you what it produced.
      This is what it was not allowed to produce.</p>${rows}</details>`;
}

function renderArc(arc, raw, name, role){
  // The throughline and the tension are the two highest-value inferences in
  // the whole system and neither can be quote-checked directly - they are
  // syntheses, not citations. Left ungrounded, the app will happily render an
  // invented headline over a set of perfectly verified beats and print a
  // reassuring "0 were deleted" underneath it. So they are grounded
  // transitively: they stand only on the claims that survived verification,
  // and when nothing survived, they are labelled unsupported rather than
  // shown as findings.
  const kept = arc.departures.length + arc.pursuits.length;
  // A line nobody could source is not a finding, and printing it in the
  // largest type on the page with a warning underneath makes the warning lose
  // an argument it should not be having. Unsupported synthesis is folded away
  // and named for what it is; opening it is a deliberate act.
  const ground = (quotes, what) => {
    if (quotes && quotes.length){
      const q = quotes.map(x=>`<q>${esc(x)}</q>`).join("");
      return `<span class="ground ok">anchored in the profile's own words
                &middot; confidence ${arc.confidence}</span>${q}`;
    }
    // Transitively grounded: no single line states it, but it rests on claims
    // that each survived the verbatim check. Calling that a guess was wrong -
    // it made the app hide the connective tissue it exists to find, on profiles
    // where every claim underneath it had passed.
    if (kept > 0){
      return `<span class="ground derived">No single line in the profile states
        this. It is a reading of the ${kept} claim${kept===1?"":"s"} below, each of
        which quotes the profile word for word &middot; confidence
        ${arc.confidence}</span>`;
    }
    return `<span class="ground bad">Nothing in the profile could be quoted to
      support this ${what}, and no claim underneath it survived either, so it is
      the model's guess and nothing more. It carries no confidence score, because
      there is nothing to score.</span>`;
  };
  // The whole block, not just its footnote: a supported line reads as a
  // finding, an unsupported one reads as a question somebody asked.
  const shape = (cls, label, line, quotes, what) => {
    if (quotes && quotes.length)
      return `<div class="shape ${cls}"><span class="lbl">${label}</span>
        <p>${esc(line)}</p>${ground(quotes, what)}</div>`;
    // A synthesis over verified claims is shown, and named as a reading. Only a
    // synthesis over nothing is folded away. The old code collapsed both, which
    // meant a profile with 8 of 8 claims surviving still had its throughline
    // hidden behind the words "unsupported guess".
    if (kept > 0)
      return `<div class="shape ${cls} derived"><span class="lbl">${label}
        &mdash; a reading, not a quote</span>
        <p>${esc(line)}</p>${ground(quotes, what)}</div>`;
    return `<details class="shape ${cls} ungrounded"><summary><span class="lbl">${label}
        &mdash; nothing survived to build it on, hidden</span></summary>
      <p class="guess">${esc(line)}</p>${ground(quotes, what)}</details>`;
  };
  const grounded = !!(arc.throughline_evidence && arc.throughline_evidence.length);

  $("#out").innerHTML = `
    ${shape("", "Their story in one line", arc.throughline, arc.throughline_evidence, "reading")}
    <canvas id="arc"></canvas>
    <div class="arckey">
      <span class="k"><i style="background:#F1580A"></i>the person</span>
      <span class="k"><i style="background:#FF6B57"></i>left behind <b>&larr; left side</b></span>
      <span class="k"><i style="background:#3FE0C4"></i>reaching for <b>right side &rarr;</b></span>
      <span class="k"><i style="background:#3FE0C4"></i><i class="sm" style="background:#3FE0C4"></i>
        <b>big &amp; close</b> = the profile says it plainly &middot;
        <b>small &amp; far</b> = inferred</span>
      <span class="k"><i class="mine"></i>yours, not evidenced</span>
      <span class="hint">hover a claim or its label for the quote &middot; or press Tab and use
        the arrow keys &middot; click empty space to add one &middot;
        shift-drag to connect &middot; double-click yours to delete</span>
    </div>
    <div class="bar"><span>${arc.departures.length+arc.pursuits.length} claim${arc.departures.length+arc.pursuits.length===1?"":"s"} survived the verbatim check
      &middot; confidence <b>${arc.confidence}</b></span></div>
    <div id="detail" class="detail"><span class="lbl">Click any node</span>
      <p>Every claim here quotes the source word for word. Anything the model could not
      quote was deleted, not flagged.</p></div>
    ${rejects(arc._unsupported)}
    <div class="cols">
      <div><span class="lbl">What they left</span><div id="deps"></div></div>
      <div><span class="lbl">What they are reaching for</span><div id="purs"></div></div>
    </div>
    ${shape("tension", "The open question", arc.unresolved_tension, arc.tension_evidence, "question")}
    <div class="row copyrow"><button class="btn" type="button" id="copybtn" onclick="copyBrief()">Copy brief</button></div>
    ${role ? renderFit(computeFit(raw, role), arc) : ""}`;
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

// ---- role fit (deterministic keyword overlap, no model call) ----------------
const FIT_STOP = new Set(["and","the","for","with","you","our","are","was","were","has",
  "have","had","not","but","this","that","they","them","their","who","what","when","will",
  "would","can","could","should","from","into","out","end","own","all","any","new","role",
  "work","working","team","teams","years","year","job","about","than","then","there","here",
  "your","his","her","its","been","being","some","more","most","such","each","other","also",
  "how","why"]);
function fitTokens(text){
  return new Set((String(text||"").toLowerCase().match(/[a-z][a-z+#.]{2,}/g)||[])
    .filter(w => !FIT_STOP.has(w)));
}
function computeFit(profileText, roleText){
  const roleTerms = fitTokens(roleText);
  const profileTerms = fitTokens(profileText);
  const matched = [...roleTerms].filter(t => profileTerms.has(t)).sort();
  return { matched, ratio: roleTerms.size ? matched.length / roleTerms.size : 0,
           roleTerms: roleTerms.size };
}
function renderFit(fit, arc){
  if(!fit.roleTerms) return "";
  const pct = Math.round(fit.ratio * 100);
  const aligned = [...arc.pursuits, ...arc.departures].filter(b =>
    fit.matched.some(t => b.description.toLowerCase().includes(t)
                       || b.evidence.toLowerCase().includes(t)));
  return `<div class="fitblock">
    <span class="lbl">Role fit &mdash; keyword overlap (no model)</span>
    <p style="margin:8px 0 0;font-size:15px">${pct}% of role terms appear in the
      profile &mdash; ${fit.matched.length} of ${fit.roleTerms}. Deterministic:
      no AI judgment, no scoring, just shared vocabulary.</p>
    ${fit.matched.length ? `<div style="margin-top:12px"><span class="lbl">Shared terms</span>
      <div style="margin-top:6px">${fit.matched.map(t=>`<span class="ftag">${esc(t)}</span>`).join("")}</div>
    </div>` : ""}
    ${aligned.length ? `<div style="margin-top:14px"><span class="lbl">Arc beats that name role terms</span>
      ${aligned.map(b=>`<div class="beat" style="margin-top:8px"><div class="bh"><b>${esc(b.description)}</b></div><q>${esc(b.evidence)}</q></div>`).join("")}
    </div>` : `<p style="margin:10px 0 0;font-size:14px;color:var(--ink3)">No arc beats explicitly name role terms &mdash; overlap is in the profile text but not in any surviving claim.</p>`}
  </div>`;
}

// ---- copy brief as plain text -----------------------------------------------
function briefText(arc, name){
  const L = [];
  if(name) L.push(name + "’s career arc", "");
  L.push("THROUGHLINE", arc.throughline);
  (arc.throughline_evidence||[]).forEach(q => L.push('  “' + q + '”'));
  L.push("");
  if(arc.departures.length){
    L.push("WHAT THEY LEFT");
    arc.departures.forEach(b => { L.push("— " + b.description); L.push('  “' + b.evidence + '”'); });
    L.push("");
  }
  if(arc.pursuits.length){
    L.push("WHAT THEY ARE REACHING FOR");
    arc.pursuits.forEach(b => { L.push("— " + b.description); L.push('  “' + b.evidence + '”'); });
    L.push("");
  }
  if(arc.unresolved_tension){
    L.push("THE OPEN QUESTION", arc.unresolved_tension);
    (arc.tension_evidence||[]).forEach(q => L.push('  “' + q + '”'));
    L.push("");
  }
  const kept = arc.departures.length + arc.pursuits.length;
  L.push("Confidence: " + arc.confidence + " · " + kept + " claim" + (kept===1?"":"s") + " survived verbatim check");
  L.push("Generated by narrative-sourcing — https://pbchrist.github.io/narrative-sourcing/");
  return L.join("\n");
}
function copyBrief(){
  const arc = LAST_ARC; if(!arc) return;
  const name = ($("#name")||{}).value||"";
  const text = briefText(arc, name.trim());
  const btn = $("#copybtn");
  const done = () => { if(btn){ btn.textContent="Copied!"; setTimeout(()=>{ btn.textContent="Copy brief"; },2000); } };
  if(navigator.clipboard && navigator.clipboard.writeText)
    navigator.clipboard.writeText(text).then(done).catch(()=>fallbackCopy(text,done));
  else fallbackCopy(text, done);
}
function fallbackCopy(text, cb){
  const ta = document.createElement("textarea");
  ta.value=text; ta.style.cssText="position:fixed;opacity:0";
  document.body.appendChild(ta); ta.select();
  try{ document.execCommand("copy"); cb(); }catch(e){}
  document.body.removeChild(ta);
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
  if(/^413\b/.test(m) || /too long/i.test(m))
    return "That was too much text for one request. Trim the profile down to the "
         + "parts that matter and run it again.";
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
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
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
  // How wide one code is, in hex digits. Taking it from whichever key happened
  // to be inserted first gets it wrong whenever a table mixes widths; the
  // width most of the table agrees on is the one the page is drawn in.
  const tally = new Map();
  for(const k of map.keys()) tally.set(k.length, (tally.get(k.length) || 0) + 1);
  let best = 4, seen = -1;
  for(const [width, n] of tally) if(n > seen){ seen = n; best = width; }
  map.w = best;
  return map;
}

// tally counts glyphs this run could and could not turn back into letters.
// Without it a PDF whose font tables cannot be read still returns a full page
// of characters - they are just glyph numbers wearing the wrong clothes, and
// that is worse than an error, because the rest of this app will treat them as
// the person's own words.
function decodeHex(hex, map, tally){
  if(!map || !map.size){
    if(tally) tally.unmapped += Math.ceil(hex.length / 4);
    return hexToText(hex);
  }
  const w = map.w || 4;
  let out = "";
  for(let i = 0; i < hex.length; i += w){
    const code = hex.slice(i, i + w).toLowerCase();
    if(map.has(code)){ out += map.get(code); if(tally) tally.mapped++; }
    else if(tally) tally.unmapped++;
  }
  return out;
}

// Simple fonts (a résumé printed from Word or Pages) draw with one byte per
// glyph inside an ordinary (string), and those bytes are subset glyph numbers
// too: byte 0x21 is the first glyph the document happened to use, not "!".
// Their ToUnicode table is keyed the same way, so it applies here as well.
// The bullet at the front of every résumé line is usually SymbolMT with
// /Encoding /MacRomanEncoding and no ToUnicode table at all - properly
// encoded, just not in the encoding a browser reads bytes in. Byte 0xA5 is a
// bullet there and a yen sign in Latin-1, which is why the impact section came
// out filed under Japanese currency. Only the punctuation that actually turns
// up in documents is listed; anything else stays as it was.
const MACROMAN = {0xA5:"\u2022",0xC9:"\u2026",0xD0:"\u2013",0xD1:"\u2014",
  0xD2:"\u201C",0xD3:"\u201D",0xD4:"\u2018",0xD5:"\u2019",0xA0:"\u2020",
  0xA6:"\u00B6",0xA9:"\u00A9",0xA8:"\u00AE",0xAA:"\u2122",0xC7:"\u00AB",
  0xC8:"\u00BB",0xD9:"\u0178",0xE1:"\u00B7"};

function decodeBytes(s, map, tally){
  if(!map) return s;
  if(map.macroman)
    return s.replace(/[\u0080-\u00FF]/g, c => MACROMAN[c.charCodeAt(0)] || c);
  // A font known to be unreadable: the characters are handed back rather than
  // dropped, in case the judgement was wrong, but they are counted as what
  // they are so a page mostly set in one gets refused instead of believed.
  if(map.blind){ if(tally) tally.unmapped += s.replace(/\s/g, "").length; return s; }
  if(map.w !== 2) return s;
  let out = "";
  for(const ch of s){
    const c = ch.charCodeAt(0);
    const code = c.toString(16).padStart(2, "0");
    if(map.has(code)){ out += map.get(code); if(tally) tally.mapped++; }
    else if(c === 9 || c === 10 || c === 32) out += ch;
    else if(tally) tally.unmapped++;
  }
  return out;
}

// Pull text out of one content stream, switching decoder whenever the page
// switches font.
//
// A line ends where the baseline moves, and nowhere else. Ending one at every
// draw call instead looks right until it meets a PDF printed from Pages or
// Word, which splits a single line into a text object per kerning pair: "time
// -to-hire" arrives as five separate draws on one baseline, and a break after
// each turns the résumé into confetti. Every hyphenated word in it came out
// broken, and those broken words are what a quote would have been cut from.
function pdfTextFrom(str, fontMaps, tally){
  let out = "", cur = null, y = null, x = null;
  const N = "([-\\d.]+)\\s+";
  const re = new RegExp(
      "\\/([A-Za-z0-9]+)\\s+[\\d.]+\\s+Tf"          // font
    + "|" + N + N + N + N + N + N + "Tm"          // absolute text matrix
    + "|" + N + N + "T[dD]"                       // relative move
    + "|\\((?:[^()\\\\]|\\\\.)*\\)\\s*Tj"
    + "|<([0-9A-Fa-f\\s]*)>\\s*Tj"
    // A kerned run is an array of strings and numbers, and a string in it may
    // itself contain a bracket. Matching "anything that is not a bracket"
    // stops at the first one and loses the whole line - which is how a job
    // title here and an employer there went missing with nothing to show it.
    + "|\\[(?:\\((?:[^()\\\\]|\\\\.)*\\)|<[0-9A-Fa-f\\s]*>|[^\\[\\]])*\\]\\s*TJ"
    + "|T\\*|BT", "g");
  let m;
  while((m = re.exec(str))){
    const tok = m[0];
    if(m[1] !== undefined){ cur = fontMaps.get(m[1]) || null; continue; }
    if(m[7] !== undefined){                       // ... Tm
      const [nx, ny] = [parseFloat(m[6]), parseFloat(m[7])];
      // The baseline moved, or the pen went back to the left of where it was:
      // either way that is a new line. The second test matters because the
      // matrix is read raw, without the page transform in front of it, so two
      // runs under different transforms can share a y that means nothing.
      if(y !== null && (Math.abs(ny - y) > 0.6 || nx < x - 1)) out += "\n";
      y = ny; x = nx; continue;
    }
    if(m[9] !== undefined){                       // ... Td / TD
      if(Math.abs(parseFloat(m[9])) > 0.6){ out += "\n"; if(y !== null) y += parseFloat(m[9]); }
      continue;
    }
    if(tok === "BT") continue;
    if(tok === "T*"){ out += "\n"; continue; }
    if(tok.startsWith("<")){
      out += decodeHex((m[10] || "").replace(/\s/g, ""), cur, tally);
      continue;
    }
    if(tok.startsWith("[")){
      const items = tok.match(/<[0-9A-Fa-f\s]*>|\((?:[^()\\]|\\.)*\)/g) || [];
      for(const it of items){
        out += it.startsWith("<")
          ? decodeHex(it.slice(1,-1).replace(/\s/g,""), cur, tally)
          : decodeBytes(pdfEscapes(it.slice(1,-1)), cur, tally);
      }
      continue;
    }
    const lit = tok.match(/\((?:[^()\\]|\\.)*\)/);
    if(lit) out += decodeBytes(pdfEscapes(lit[0].slice(1,-1)), cur, tally);
  }
  return out;
}

// Where the compressed data actually ends. Slicing up to "endstream" leaves
// the newline before it attached, and both Node and the browser reject that as
// trailing junk rather than ignoring it - which is why this silently returned
// nothing until it was traced.
function streamEnd(latin, dict, from, objAt){
  // /Length is either a number or a reference to one, and Apache FOP - which
  // writes every LinkedIn export - uses the reference. Two traps in a row.
  // First: the obvious regex for "a number NOT followed by N R" backtracks,
  // so "/Length 78 0 R" matches "/Length 7" and slices seven bytes out of a
  // twelve thousand byte stream. Second: in "/Length 227 0 R" the object being
  // referenced is 227, the number in front; the 0 is the generation. Following
  // the generation looks up object 0, which never exists, so every indirect
  // length fell through to the scan below without ever saying so.
  const m = /\/Length\s+(\d+)(\s+(\d+)\s+R)?/.exec(dict);
  if(m && !m[2]) return from + parseInt(m[1], 10);
  if(m && m[2] && objAt){
    const at = objAt.get(m[1]);
    if(at){
      const v = /obj\s*(\d+)/.exec(latin.slice(at[0], at[1]));
      if(v) return from + parseInt(v[1], 10);
    }
  }
  // And the scan is only a guess, because compressed bytes are not text: the
  // single end-of-line the spec puts before "endstream" is separator, but a
  // 0x09 or 0x20 in front of it is data. Eating every trailing whitespace byte
  // truncated the stream by one and inflate refused the whole thing - which is
  // exactly how a LinkedIn export came out as glyph numbers.
  let to = latin.indexOf("endstream", from);
  if(to < 0) return -1;
  if(latin[to - 1] === "\n") to--;
  if(latin[to - 1] === "\r") to--;
  return to;
}

async function readPdf(bytes){
  const latin = new TextDecoder("latin1").decode(bytes);

  // A locked file has no readable text for the same reason a scan has none,
  // and it used to be told to run OCR - advice that cannot possibly work. The
  // trailer says which problem this is, so say the right one.
  if(/\/Encrypt\s+\d+\s+0\s+R/.test(latin))
    throw new Error("that PDF is password-protected, so its text cannot be read. "
                  + "Open it, save an unprotected copy, and drop that in instead");

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

  // /F4 -> font object -> its ToUnicode table. The resource dictionary is
  // either written inline (/Font << /F4 12 0 R >>) or kept as an object of its
  // own and pointed at (/Font 27 0 R). LibreOffice writes the second kind, and
  // reading only the first left those files with no font tables at all.
  const fontObj = new Map();
  const named = (block) => {
    const pr = /\/([A-Za-z0-9]+)\s+(\d+)\s+0\s+R/g;
    let g; while((g = pr.exec(block))) fontObj.set(g[1], g[2]);
  };
  const fr = /\/Font\s*<<([\s\S]*?)>>/g;
  let fm;
  while((fm = fr.exec(latin))) named(fm[1]);
  const fir = /\/Font\s+(\d+)\s+0\s+R/g;
  while((fm = fir.exec(latin))){
    const at = objAt.get(fm[1]);
    if(at) named(latin.slice(at[0], at[1]));
  }
  const fontMaps = new Map();
  const BLIND = new Map(); BLIND.blind = true;
  for(const [name, num] of fontObj){
    const at = objAt.get(String(num));
    if(!at) continue;
    const dict = latin.slice(at[0], at[1]);
    const tu = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(dict);
    if(tu){
      const cmap = await streamOf(tu[1]);
      if(cmap){ fontMaps.set(name, parseCMap(cmap)); continue; }
    }
    // "ABCDEF+Helvetica" is a subset: the six-letter tag is the spec's way of
    // saying the font in this file is a cut-down copy with its own numbering.
    // One that carries neither a ToUnicode table nor a named encoding has
    // taken the key away with it, so its bytes are glyph numbers and cannot be
    // read back - by construction, not by bad luck.
    if(/\/Encoding\s*\/MacRomanEncoding/.test(dict)){
      const mac = new Map(); mac.macroman = true; fontMaps.set(name, mac); continue;
    }
    if(/\/BaseFont\s*\/[A-Z]{6}\+/.test(dict)
       && !/\/Encoding\s*\/\w/.test(dict) && !/\/Differences/.test(dict))
      fontMaps.set(name, BLIND);
  }

  // Walk the objects, not every occurrence of the word "stream" - "endstream"
  // contains one too, so scanning for the bare word finds two hits per stream
  // and judges the second one by a 400-character window of compressed bytes.
  // That window is also how whole paragraphs went missing: a content stream
  // whose neighbour happened to mention /ToUnicode was skipped entirely, and
  // the résumé simply came out without them. An object's own dictionary is the
  // thing that says what it holds.
  let text = "";
  const tally = { mapped: 0, unmapped: 0 };
  for(const at of objAt.values()){
    const obj = latin.slice(at[0], at[1]);
    const sm = /stream\r?\n?/.exec(obj);
    if(!sm) continue;
    const dict = obj.slice(0, sm.index);
    // Fonts, font programs, images, and the tables that decode them are not
    // page text. /Length1 is what marks an embedded font program.
    if(/\/Type\s*\/(Font|XObject|Metadata|ObjStm|XRef)|\/ToUnicode|\/FontFile|\/Length1|\/Image|\/DCTDecode|\/JPXDecode|\/CCITTFaxDecode|beginbfchar/.test(dict))
      continue;
    const from = at[0] + sm.index + sm[0].length;
    const end = streamEnd(latin, dict, from, objAt);
    if(end < 0 || end <= from) continue;
    let body;
    if(/\/FlateDecode/.test(dict)){
      try { body = new TextDecoder("latin1").decode(
              await inflate(bytes.subarray(from, end), "deflate")); }
      catch(e){ continue; }
    } else {
      body = latin.slice(from, end);
    }
    if(!/Tj|TJ/.test(body)) continue;
    text += pdfTextFrom(body, fontMaps, tally);
  }
  // Typographic ligatures come back as single characters and would otherwise
  // show up inside quotes as "ﬁnd".
  const LIG = {"\uFB00":"ff","\uFB01":"fi","\uFB02":"fl","\uFB03":"ffi","\uFB04":"ffl","\uFB05":"st","\uFB06":"st"};
  text = text.replace(/[\uFB00-\uFB06]/g, c => LIG[c] || c)
             .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
             .replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n")
             // A word the page broke across two lines is still one word, and a
             // quote is only verbatim if it says so: "hiring-\nmanager
             // partnerships" has to come back as "hiring-manager
             // partnerships". Only a lower-case letter closes the join, so a
             // real trailing dash keeps its line.
             .replace(/-\n([a-z])/g, "-$1")
             .replace(/\n{3,}/g, "\n\n").trim();
  // Refusing beats handing back nonsense. A PDF that draws with a subset font
  // and no readable ToUnicode table produces a full page of characters that
  // are glyph numbers, not letters - and every gate downstream would then
  // verify quotes against gibberish and report that nothing was deleted.
  const seen = tally.mapped + tally.unmapped;
  if(seen > 40 && tally.unmapped / seen > 0.2)
    throw new Error("that PDF stores its text as numbered shapes from a cut-down font "
                  + "and does not carry the table that maps them back to letters, so "
                  + "what came out was not words. Save it as .docx, or open it and "
                  + "paste the text in");
  // Belt and braces for whatever the counters do not see: real prose does not
  // arrive as control bytes.
  const solid = text.replace(/\s/g, "");
  const noise = (solid.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length;
  if(solid.length && noise / solid.length > 0.02)
    throw new Error("that PDF came out as control characters rather than text — its "
                  + "fonts could not be read. Save it as .docx, or paste the text in");
  text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
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

let LAST_FILE = null;                 // what a nameless record gets called after

async function addFiles(files){
  const list = [...files];
  if(!list.length) return;
  LAST_FILE = list.length === 1 ? list[0].name : `${list.length} files`;
  status(`Reading ${list.length} file${list.length>1?"s":""}…`);
  const got = [], read = [], failed = [];
  for(const f of list){
    try{
      const text = await readAnyFile(f);
      if(text){ got.push(text); read.push(`${f.name} — ${text.length.toLocaleString()} characters`); }
      else failed.push(`${f.name} (it was empty)`);
    }catch(e){ failed.push(`${f.name} — ${e.message}`); }
  }
  if(got.length){
    const box = $("#profile");
    box.value = (box.value.trim() ? box.value.trim() + "\n\n" : "") + got.join("\n\n");
  }
  // The character count is not decoration. A file that came out unreadable can
  // still look like almost nothing in the box while carrying twenty thousand
  // characters of it, and the number is the only thing that says so.
  status(failed.length
    ? `Read ${read.join("; ") || "nothing"}. Could not read: ${failed.join("; ")}`
    : `Read ${read.join("; ")}. Have a look before you run it.`,
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
// LinkedIn prints how long the role lasted after the dates: "January 2023 -
// Present (3 years 8 months)". Anchoring straight after the closing year meant
// every dated role in a LinkedIn export was invisible - the only spans a real
// export produced came from the education section, which has no durations. A
// career the timeline cannot see is a career it cannot order.
const DUR = "(?:\\s*\\((?:less than a year|[^)]*\\b(?:years?|months?|yrs?|mos?)\\b[^)]*)\\))?";
const RANGE = new RegExp("^[\\s·•\\-–(\\[]*" + PRE + "(" + Y + ")"
  + "\\s*(?:[-–—]|to|until)\\s*" + PRE + "(" + Y + "|" + OPEN + ")" + DUR + "[\\s)\\]·•]*$", "i");
const SINCE = new RegExp("^[\\s·•(\\[]*(?:since|from)\\s+" + PRE + "(" + Y + ")" + DUR + "[\\s)\\]·•]*$", "i");
// The other way round, and just as common in a plain-text CV:
// "2016-2019  Data Analyst, Shopify". Every pattern here wanted the label in
// front, so a whole familiar résumé layout produced no timeline at all - and
// with no timeline the departure gate cannot use dates to prove a role ended.
// The label has to begin with a word: a parenthetical after the dates is a
// note about the role, not the name of it.
const LEADING = new RegExp("^[\\s·•(\\[]*" + PRE + "(" + Y + ")"
  + "\\s*(?:[-–—]|to|until)\\s*" + PRE + "(" + Y + "|" + OPEN + ")" + DUR
  + "[\\s)\\]·•:,\\-–]+([A-Za-z0-9].{2,89}?)[\\s.]*$", "i");
const INLINE = new RegExp("^(.{3,90}?)[,;·•\\s]+" + PRE + "(" + Y + ")"
  + "\\s*(?:[-–—]|to|until)\\s*" + PRE + "(" + Y + "|" + OPEN + ")" + DUR + "[\\s)\\]·•]*$", "i");
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
    m = LEADING.exec(bare);
    if(m){
      const label = m[3].replace(/^[\s,;·•\-–]+|[\s,;·•\-–]+$/g, "");
      if(label && !NOT_A_LABEL.has(label.toLowerCase())){
        spans.push({label, start: tlYear(m[1]),
                    end: /^\d/.test(m[2]) ? tlYear(m[2]) : null, line: i});
        return;
      }
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
  if(!configured()){
    status("This runs against a model you choose — click Settings to point it at one. "
         + "The worked example needs nothing and is the honest demonstration anyway.", 1);
    $("#settings").showModal(); return;
  }
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
    let raw = parts.join("\n\n");
    let chron = timelineSummary(extractTimeline(raw));
    // One request has a size, and a LinkedIn export is bigger than people
    // expect. Trim `raw` itself rather than only the prompt: every quote is
    // checked back against `raw`, so sending less than was verified against
    // would let a quote pass that the model was never shown - a silent
    // inconsistency in the one part of this that is supposed to have none.
    const whole = raw.length;
    const mine = settings().url;
    const cap = (!mine || /\.trycloudflare\.com/.test(mine)) ? CAP : OWN_CAP;
    raw = fitTo(raw, Math.max(0, cap - weigh(SYSTEM) - weigh(chron) - 500));
    const cut = whole - raw.length;
    if(cut > 0){
      chron = timelineSummary(extractTimeline(raw));   // shorter text, shorter chronology
      failures = failures.concat(
        [`only the first ${raw.length.toLocaleString()} characters were read — `
         + `${cut.toLocaleString()} more would not fit in one request`]);
    }
    const who0 = name || guessName(raw, LAST_FILE);
    const who = onePerson(raw);
    if(!who.ok) failures = failures.concat(
      [`heads up — ${who.why} (${who.evidence.join("; ")})`]);
    // Whatever is on screen belongs to whoever was analysed last, and leaving
    // it there while a different profile is being read invites reading one
    // person's conclusions as the other's.
    $("#out").innerHTML = `<div class="shape pending"><span class="lbl">Reading</span>
      <p>${esc(who0 || "this profile")}</p>
      <span class="ground ok">nothing below is showing yet &mdash; the previous
        result has been cleared so it cannot be mistaken for this one</span></div>`;
    status(`Reading the arc for ${who0 || "this profile"}. This takes as long as your model takes.`);
    const data=extractJSON(await complete(
      (chron ? `CHRONOLOGY (earliest first — this is the real order, whatever order the document below is in). `
             + `This list was assembled from the dates below and is NOT part of the profile: never quote from it, `
             + `because a quote taken from here is not the person's own words and will be discarded.\n${chron}\n\n` : "")
      + `PROFILE TEXT (quote only from between these markers):\n---BEGIN PROFILE---\n${raw}\n---END PROFILE---`));
    processArc(data, raw, name, ($("#role")||{value:""}).value.trim());
    remember(who0 || `profile · ${new Date().toLocaleString()}`,
             {arc: LAST_ARC, raw, name,
              candidate_name: name || guessName(raw, "") || null,
              source_filename: LAST_FILE || null,
              created_at: new Date().toISOString(),
              run_id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()))});
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
        if(!b||!b.description) return false;
        if(!verify(b.evidence,raw)){
          const fixed=snap(b.evidence,raw);
          if(!fixed){
            // The loudest rejection there is, and it used to happen in
            // silence: the model produced a sentence and attributed it to
            // someone who never wrote it.
            unsupported.push({d:b.description, q:b.evidence,
              why:"No such sentence appears in the profile. The model wrote it."});
            return false;
          }
          b.evidence=fixed;                     // judged on what is really there
        }
        // The record can say a claim is simply the wrong way round.
        if(spans.length && contradictsOrder(b.description, spans)){
          unsupported.push({d:b.description, q:b.evidence,
            why:"The dates in the profile run the other way."});
          return false;
        }
        let v=entails(b.description,b.evidence);
        // A CV proves a departure with dates, not with the word "left".
        if(!v.ok && spans.length && /leaving/.test(v.reason)
           && (provesDeparture(b.evidence, spans, raw) || confirmsOrder(b.description, spans)))
          v = {ok:true, reason:"The record shows this role ended and other work followed."};
        if(!v.ok){ unsupported.push({d:b.description, q:b.evidence, why:v.reason}); return false; }
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
      .filter(q => {
        if(typeof q !== "string") return false;
        if(!verify(q, raw)){
          const fixed = snap(q, raw);
          if(!fixed) return false;
          q = fixed;
        }
        if(!claim) return true;
        const v = entails(claim, q);
        if(v.ok) return true;
        // Same allowance the beats get: a career history proves someone left
        // by showing the role ended and other work following it, which is how
        // a CV says it. Withholding that here meant the headline was held to a
        // stricter standard than the claims underneath it.
        return spans.length && /leaving/.test(v.reason)
               && (provesDeparture(q, spans, raw) || confirmsOrder(claim, spans));
      }).map(q => norm(snap(q, raw) || q));
    const arc={throughline:data.throughline,unresolved_tension:data.unresolved_tension||"",
               throughline_evidence:keepQuotes(data.throughline_evidence, data.throughline),
               tension_evidence:keepQuotes(data.tension_evidence, data.unresolved_tension||""),
               departures:keep(data.departures),pursuits:keep(data.pursuits)};
    arc.confidence=score([...arc.departures,...arc.pursuits]);
    arc._proposed = dropped; arc._unsupported = unsupported;
    return arc;
}

function processArc(data, raw, name, role){
  const arc = buildArc(data, raw);
  LAST_ARC = arc;
  renderArc(arc, raw, name, role);
  return arc;
}

function statusFor(data, raw){
  const arc = LAST_ARC || buildArc(data, raw);
  const kept = arc.departures.length + arc.pursuits.length;
  const un = arc._unsupported.length
    ? ` ${arc._unsupported.length} had a real quote that did not support the claim (${arc._unsupported[0].why})`
    : "";
  // Refusing to invent an arc is the best thing this tool does, and a bare
  // "0 of 0 claims survived" made it look broken instead. Two different empty
  // results, and the reader needs to be told which one they got.
  if(kept === 0){
    if(arc._proposed === 0){
      return "Nothing to build an arc from. This reads as description rather than " +
             "specifics — no roles left, no moves made, nothing dated or named that " +
             "a quote could point at. That is a finding about the profile, not an error.";
    }
    return `Every claim was deleted — ${arc._proposed} proposed, ${arc._proposed} thrown out, ` +
           `because none of them could be traced to a line in the profile.${un} ` +
           `That is the rule working, not a failure.`;
  }
  return `${kept} of ${arc._proposed} claim${arc._proposed===1?"":"s"} survived. ${arc._proposed-kept} deleted.${un}`;
}
function status(m,bad,action){
  const s=$("#status"); s.textContent=m; s.className=bad?"bad":"";
  if(action){
    const b=document.createElement("button");
    b.type="button"; b.className="linky"; b.textContent=action;
    b.onclick=unstash; s.appendChild(b);
  }
}

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
// A two-column résumé put the word PROFILE on the first extracted line and a
// saved search was filed under it; another was filed under "I'm looking for...",
// which was the search prompt. A record about a person is named after the
// person, and when that cannot be found it says where it came from instead of
// guessing.
const HEADINGS = new Set(["contact","profile","summary","about","experience",
  "education","skills","top skills","certifications","licenses","languages",
  "honors","awards","publications","recommendations","volunteering","projects",
  "interests","references","objective","work history","employment"]);

// A LinkedIn export puts the person's name on line 21, underneath a sidebar of
// contact details, skills and certifications - so "first line that looks like a
// name" picks the first listed skill, and this shipped calling somebody
// "Source Intelligence". A two-column résumé puts a section heading first and
// the name second. No single position works, so every name-shaped line is a
// candidate and the surroundings decide between them.
const SIDEBAR = new Set(["top skills","skills","certifications","licenses",
  "languages","honors","awards","publications","interests","volunteering"]);
const LOOKS_LIKE_A_PLACE = /,\s*[A-Z][\p{L}]+(,|$)/u;

function guessName(raw, fallbackFile){
  const lines = String(raw||"").split("\n").map(l =>
    l.replace(/^[\s·•\-–]+|[\s·•\-–]+$/g, ""));
  let best = null, bestScore = -Infinity;
  for(let i = 0; i < Math.min(lines.length, 40); i++){
    const t = lines[i];
    if(!t || t.length > 46) continue;
    if(HEADINGS.has(t.toLowerCase().replace(/:$/, ""))) continue;
    if(/\d|@|https?:|www\./.test(t)) continue;
    const words = t.split(/\s+/);
    if(words.length < 2 || words.length > 4) continue;
    if(!words.every(w => /^[A-Z][\p{L}'’.-]*$/u.test(w))) continue;

    let score = 0;
    // The first entry under a list of skills or certifications is an entry in
    // that list, not the person the document is about.
    const prev = lines.slice(0, i).reverse().find(Boolean);
    if(prev && SIDEBAR.has(prev.toLowerCase().replace(/:$/, ""))) score -= 3;
    // A name is followed by the things that describe the person: a headline
    // with pipes, a location, and then the body of the document.
    const next = lines[i+1] || "";
    if(next.includes("|")) score += 2;
    if(LOOKS_LIKE_A_PLACE.test(next)) score += 2;
    if(lines.slice(i+1, i+7).some(l => ["summary","about","experience"]
        .includes(l.toLowerCase().replace(/:$/, "")))) score += 3;
    if(i < 3) score += 1;                      // a plain résumé leads with it

    if(score > bestScore){ bestScore = score; best = t; }
  }
  if(best) return best;
  if(fallbackFile) return fallbackFile;
  return "";
}

const HMAX = 8;
function hist(){ try{ return JSON.parse(localStorage.getItem(HKEY)) || []; }catch{ return []; } }
// Somebody reading candidates on a shared machine can turn the history off
// entirely, and the footer says plainly that it exists - which it did not.
const NOHIST = "ns.nohistory";
const keepingHistory = () => localStorage.getItem(NOHIST) !== "1";

function remember(label, payload){
  if(!keepingHistory()) return;
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
  // The source comes back with the analysis, always. Leaving whoever was in
  // the box where they were put one person's profile directly above another
  // person's conclusions, with every individual line on screen perfectly
  // plausible - the hardest kind of mistake to notice and the worst kind to
  // make about a real candidate. Saying "the boxes above are still yours" in
  // the status line acknowledged the mismatch without preventing it.
  const box = $("#profile"), name = $("#name"), gh = $("#gh");
  if(box.value.trim() && box.value.trim() !== String(e.payload.raw || "").trim())
    STASH = {raw: box.value, name: name.value, gh: gh.value};
  box.value = e.payload.raw || "";
  name.value = e.payload.name || "";
  gh.value = "";                       // sources were already folded into raw
  renderArc(e.payload.arc, e.payload.raw, e.payload.name);
  status(`Showing ${e.label} — the profile above is ${e.label}'s too.`
         + (STASH ? "  ·  " : ""), 0, STASH ? "Put back what I was working on" : null);
}

// What was in the boxes before a prior search replaced it, so restoring the
// source is not the same as losing the thing you were part-way through.
let STASH = null;
function unstash(){
  if(!STASH) return;
  $("#profile").value = STASH.raw; $("#name").value = STASH.name; $("#gh").value = STASH.gh;
  STASH = null;
  $("#out").innerHTML = "";
  status("Back to what you were working on.");
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

  const jump = document.getElementById("jump");
  if(jump) jump.onclick = e => { e.preventDefault(); showExample(); };

  // Prior searches, off by choice. Turning it on clears what is already kept
  // rather than merely stopping new entries, because the reason to turn it on
  // is usually the ones that are already there.
  const nh = document.getElementById("nohist");
  if(nh){
    nh.checked = !keepingHistory();
    nh.onchange = () => {
      if(nh.checked){ localStorage.setItem(NOHIST, "1"); localStorage.removeItem(HKEY);
                      drawRecent(); status("Prior searches are off, and the kept ones are gone."); }
      else { localStorage.removeItem(NOHIST); status("Prior searches will be kept in this browser."); }
    };
  }
  status("Ready. Give it a GitHub username, or paste a profile.");
  // A first-time visitor arrives with nothing to paste. Show them a real run
  // rather than an empty page - it needs no model and no waiting.
  if(!hist().length) showExample();
});
