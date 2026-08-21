"use strict";
const $=s=>document.querySelector(s);
const LS="ns.settings.v1";
const PRESETS={
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

Return ONLY JSON:
{"throughline":"one sentence","unresolved_tension":"one sentence","departures":[{"description":"...","evidence":"verbatim quote","confidence":0.0}],"pursuits":[{"description":"...","evidence":"verbatim quote","confidence":0.0}]}

confidence is 0-1 and should reflect genuine doubt.`;

function settings(){ let s={}; try{s=JSON.parse(localStorage.getItem(LS))||{};}catch{} return s; }

// ---- the verbatim check, same rule as the CLI -------------------------------
const norm=t=>String(t||"").replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/\s+/g," ").trim();
const canon=t=>norm(t).replace(/^(\.\.\.|…)+|(\.\.\.|…)+$/g,"").replace(/^[\s"'.,;:\-—–]+|[\s"'.,;:\-—–]+$/g,"").toLowerCase();
function verify(ev, raw){ const n=canon(ev); return n.length>=12 && norm(raw).toLowerCase().includes(n); }

function score(beats){
  if(!beats.length) return 0;
  const distinct=new Set(beats.map(b=>canon(b.evidence))).size;
  const cover=Math.min(1,distinct/4);
  const mean=beats.reduce((a,b)=>a+b.confidence,0)/beats.length;
  return Math.round(cover*mean*100)/100;
}

async function complete(prompt){
  const s=settings();
  if(!s.url) throw new Error("Point it at a model first — click Settings.");
  const anth=/anthropic\.com/.test(s.url);
  const h={"Content-Type":"application/json"}; let body;
  if(anth){ h["x-api-key"]=s.key||""; h["anthropic-version"]="2023-06-01";
    h["anthropic-dangerous-direct-browser-access"]="true";
    body={model:s.model||"claude-sonnet-4-5",max_tokens:4000,system:SYSTEM,messages:[{role:"user",content:prompt}]};
  } else { if(s.key) h.Authorization="Bearer "+s.key;
    body={messages:[{role:"system",content:SYSTEM},{role:"user",content:prompt}],temperature:0.2,max_tokens:8000};
    if(s.model) body.model=s.model; }
  const r=await fetch(s.url,{method:"POST",headers:h,body:JSON.stringify(body)});
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
  $("#out").innerHTML = `
    <div class="shape"><span class="lbl">Their story in one line</span><p>${esc(arc.throughline)}</p></div>
    <canvas id="arc"></canvas>
    <div class="bar"><span>${arc.departures.length+arc.pursuits.length} claims survived the verbatim check
      &middot; confidence <b>${arc.confidence}</b></span></div>
    <div id="detail" class="detail"><span class="lbl">Click any node</span>
      <p>Every claim here quotes the source word for word. Anything the model could not
      quote was deleted, not flagged.</p></div>
    <div class="cols">
      <div><span class="lbl">What they left</span><div id="deps"></div></div>
      <div><span class="lbl">What they are reaching for</span><div id="purs"></div></div>
    </div>
    <div class="shape tension"><span class="lbl">The open question</span><p>${esc(arc.unresolved_tension)}</p></div>`;
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

async function run(){
  const gh=$("#gh").value.trim(), pasted=$("#profile").value.trim();
  if(!gh && pasted.length<80){ status("Paste a profile, or give me a GitHub username.",1); return; }
  $("#run").disabled=true;
  try{
    let raw=pasted, name=$("#name").value.trim();
    if(gh){ status(`Reading github.com/${gh}…`); const g=await fromGithub(gh); raw=g.text; name=name||g.name; $("#profile").value=raw; }
    status("Reading the arc. This takes as long as your model takes.");
    const data=extractJSON(await complete(`PROFILE TEXT (quote only from between these markers):\n---BEGIN PROFILE---\n${raw}\n---END PROFILE---`));
    if(!data.throughline) throw new Error("No throughline came back.");
    const keep=(arr)=>(arr||[]).filter(b=>b&&b.description&&verify(b.evidence,raw))
      .map(b=>({description:b.description,evidence:norm(b.evidence),
                confidence:Math.round(Math.min(Number(b.confidence)||0.5, canon(b.evidence).length>=40?0.9:0.6)*100)/100}));
    const dropped=((data.departures||[]).length+(data.pursuits||[]).length);
    const arc={throughline:data.throughline,unresolved_tension:data.unresolved_tension||"",
               departures:keep(data.departures),pursuits:keep(data.pursuits)};
    arc.confidence=score([...arc.departures,...arc.pursuits]);
    renderArc(arc,raw,name);
    const kept=arc.departures.length+arc.pursuits.length;
    status(`${kept} of ${dropped} claims quoted the profile exactly. ${dropped-kept} were deleted.`);
  }catch(e){ status(e.message,1); }
  finally{ $("#run").disabled=false; }
}
function status(m,bad){ const s=$("#status"); s.textContent=m; s.className=bad?"bad":""; }

window.addEventListener("DOMContentLoaded",()=>{
  $("#run").onclick=run;
  $("#gear").onclick=()=>{const s=settings();$("#url").value=s.url||"";$("#key").value=s.key||"";$("#model").value=s.model||"";$("#settings").showModal();};
  $("#save").onclick=e=>{e.preventDefault();
    localStorage.setItem(LS,JSON.stringify({url:$("#url").value.trim(),key:$("#key").value.trim(),model:$("#model").value.trim()}));
    $("#settings").close(); status("Endpoint saved. It stays in this browser.");};
  document.querySelectorAll("[data-preset]").forEach(b=>b.onclick=e=>{e.preventDefault();
    const p=PRESETS[b.dataset.preset]; $("#url").value=p.url; $("#model").value=p.model;});
  if(!settings().url) status("Click Settings and point it at a model to begin.");
});
