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
const REPO=new URL("..",import.meta.url).pathname;
const src=await readFile(REPO+"/docs/app.js","utf8");
const cut=(a,b)=>{const i=src.indexOf(a),j=src.indexOf(b);return src.slice(i,j);};
const api={}; new Function("exports",
  cut("const SYSTEM=","function settings(")+cut("const norm=","function extractJSON")+cut("function extractJSON","async function fromGithub")+cut("const MONTHS","async function run(){")
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
];

const out=[];
for(const p of profiles){
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
    Object.assign(rec,{proposed:beats.length, kept, invented, unsupported,
      headlineAnchored:tlOK>0, throughline:(data.throughline||"").slice(0,72)});
  }catch(e){ rec.error=String(e.message).slice(0,90); }
  out.push(rec);
  console.log(JSON.stringify(rec));
}
await writeFile(REPO+"bench/corpus-results.json", JSON.stringify(out,null,1));
