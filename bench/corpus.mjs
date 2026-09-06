// Every profile that is not the author's, through the shipped gates.
//
// The whole pipeline had only ever been checked end to end against one
// résumé - the author's own - and a tool that reads other people's careers
// cannot be tested only on the career of the person who wrote it. Running the
// twelve ablation profiles plus two deliberately hostile inputs found that a
// whole date layout ("2016-2019  Data Analyst, Shopify", dates in front) was
// invisible to the timeline, and with no timeline the departure gate cannot
// use dates to prove a role ended. Twelve of twelve profiles were written
// that way. Survival went from 46% to 77% once it could see them.
//
//     node bench/corpus.mjs        needs a model at docs/endpoint.json
//
// Deterministic by construction: temperature 0, fixed seed. Two runs of this
// should agree, and if they do not, that is the finding.

import {readFile, writeFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
// .pathname is percent-encoded, so a repo checked out under a directory with a
// space, an ampersand or an emoji in its name resolved to a path that does not
// exist and the benchmark died before its first request. fileURLToPath decodes.
const REPO=fileURLToPath(new URL("..",import.meta.url));
const src=await readFile(REPO+"/docs/app.js","utf8");
const cut=(a,b)=>{const i=src.indexOf(a),j=src.indexOf(b);return src.slice(i,j);};
const api={}; new Function("exports",
  cut("const SYSTEM=","function settings(")+cut("const norm=","function extractJSON")+cut("function extractJSON","async function fromGithub")+cut("const MONTHS","async function run(){")
  +cut("const SENDABLE = [","function buildArc(")
  +"\nexports.scanSendable=scanSendable;"
  +"\nexports.SYSTEM=SYSTEM;exports.extractJSON=extractJSON;exports.verify=verify;exports.snap=snap;"
  +"exports.entails=entails;exports.norm=norm;exports.canon=canon;exports.extractTimeline=extractTimeline;"
  +"exports.timelineSummary=timelineSummary;exports.provesDeparture=provesDeparture;"
  +"exports.confirmsOrder=confirmsOrder;exports.contradictsOrder=contradictsOrder;")(api);

const ep=JSON.parse(await readFile(REPO+"/docs/endpoint.json","utf8")).url;
const profiles=[
  ...JSON.parse(await readFile(REPO+"/ablation/profiles.json","utf8")),
  ...JSON.parse(await readFile(REPO+"/ablation/profiles-long.json","utf8")),
  // The one a hostile reader will try: almost nothing to go on.
  {id:"THIN", text:"Alex Kim\nSoftware Engineer\nAcme Corp, 2021 - present\nI like building things."},
  // And the one that is not a career at all.
  {id:"NOT_A_PROFILE", text:"Please find attached the quarterly figures for review. Regards, Accounts."},
  // A real LinkedIn page copied whole: nav, other people's cards, and a
  // corporate account's press releases sitting inside the person's own feed.
  {id:"REAL_LINKEDIN_01", text:await readFile(REPO+"bench/profiles/real_linkedin_01.txt","utf8")},
  // Text the tool must never author, planted where a chatty model would put it.
  {id:"SENDABLE_BAIT", text:"Dana Okafor\nHead of Partnerships\nStripe, 2020 - present\nBefore that: Square, 2016 - 2020.\nI am reaching out to people building in payments. Would you be open to a call? Best regards, Dana"},
];

// One profile at a time meant a fourteen-case run took ten minutes, which is
// long enough that nobody runs it, which is the same as not having it. The
// endpoint serves several requests concurrently, so the corpus goes through a
// small pool instead. POOL stays modest on purpose: this points at one box.
const POOL=Number(process.env.POOL||5);
async function pooled(items, n, fn){
  const res=new Array(items.length); let i=0;
  await Promise.all(Array.from({length:Math.min(n,items.length)}, async()=>{
    while(i<items.length){ const k=i++; res[k]=await fn(items[k]); }
  }));
  return res;
}

const t0=Date.now();
const out=await pooled(profiles, POOL, async p=>{
  const raw=p.text;
  let chron=api.timelineSummary(api.extractTimeline(raw));
  const prompt=(chron?`CHRONOLOGY (earliest first — this is the real order, whatever order the document below is in). This list was assembled from the dates below and is NOT part of the profile: never quote from it, because a quote taken from here is not the person's own words and will be discarded.\n${chron}\n\n`:"")
    +`PROFILE TEXT (quote only from between these markers):\n---BEGIN PROFILE---\n${raw}\n---END PROFILE---`;
  let rec={id:p.id, chars:raw.length, spans:api.extractTimeline(raw).length};
  try{
    const r=await fetch(ep,{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({messages:[{role:"system",content:api.SYSTEM},{role:"user",content:prompt}],
        temperature:0, top_p:1, seed:7, max_tokens:8000})});
    const d=await r.json();
    const t=(d.choices?.[0]?.message?.content||"").replace(/<think>[\s\S]*?<\/think>/gi,"").trim();
    const data=api.extractJSON(t);
    const spans=api.extractTimeline(raw);
    const beats=[...(data.departures||[]),...(data.pursuits||[])];
    let kept=0, invented=0, unsupported=0;
    for(const b of beats){
      let q=b.evidence;
      if(!api.verify(q,raw)){ const f=api.snap(q,raw); if(!f){ invented++; continue; } q=f; }
      let v=api.entails(b.description,q);
      if(!v.ok && spans.length && /leaving/.test(v.reason)
         && (api.provesDeparture(q,spans,raw)||api.confirmsOrder(b.description,spans))) v={ok:true};
      if(v.ok) kept++; else unsupported++;
    }
    const tlOK=(data.throughline_evidence||[]).filter(q=>api.verify(q,raw)||api.snap(q,raw)).length;
    // The no-sendable-text guard, measured the way the app applies it: the
    // candidate's own verified quotes are exempt, the prose around them is not.
    const guardTrips=[data.throughline, data.unresolved_tension,
                      ...beats.map(b=>b.description)]
      .filter(Boolean)
      .filter(t=>api.scanSendable(t, [data.throughline_evidence, ...beats.map(b=>b.evidence)].flat()))
      .length;
    Object.assign(rec,{proposed:beats.length, kept, invented, unsupported,
      headlineAnchored:tlOK>0, guardTrips, throughline:(data.throughline||"").slice(0,72)});
  }catch(e){ rec.error=String(e.message).slice(0,90); }
  console.log(JSON.stringify(rec));
  return rec;
});
await writeFile(REPO+"bench/corpus-results.json", JSON.stringify(out,null,1));

const ok=out.filter(r=>!r.error);
const sum=k=>ok.reduce((a,r)=>a+(r[k]||0),0);
console.log(`\n${out.length} profiles · pool ${POOL} · ${Math.round((Date.now()-t0)/1000)}s`
  +`\nproposed ${sum("proposed")} · kept ${sum("kept")} `
  +`(${Math.round(100*sum("kept")/Math.max(1,sum("proposed")))}%) · `
  +`invented-quote ${sum("invented")} · unsupported ${sum("unsupported")} · `
  +`sendable ${sum("guardTrips")}`
  +`\nerrors ${out.filter(r=>r.error).length}`);
