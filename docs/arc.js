"use strict";
// The arc as a constellation: the person at the centre, departures behind,
// pursuits ahead, the unresolved tension pulling from the front. Distance
// encodes confidence - a thinly evidenced beat sits further out and dimmer,
// so a weak read looks weak instead of reading like a finding.
const C = {person:"#F1580A", dep:"#FF6B57", pur:"#3FE0C4", ink:"#E7ECF3", dim:"#7C8FA3"};

function buildNodes(arc){
  const nodes = [{x:0,y:0,z:0,r:19,c:C.person,label:"THE PERSON",kind:"person",font:13,weight:700,data:arc}];
  // Departures go left, pursuits right, fanned wide. An earlier version put
  // everything within ~150 units of the middle and the labels became a pile;
  // the graph is only worth having if you can read it.
  const place = (beats, dir) => beats.forEach((b,i) => {
    const conf = Math.max(0.15, Math.min(1, b.confidence ?? 0.5));
    const R = 300 + (1 - conf) * 130;              // less certain, further out
    const n = beats.length;
    const spread = n > 1 ? (i/(n-1) - 0.5) : 0;    // -0.5 .. 0.5
    const ang = spread * 1.5;                      // fan, not a stack
    nodes.push({
      x: dir * Math.cos(ang) * R,
      y: spread * 210,
      z: Math.sin(ang) * R * 0.75,
      r: 7 + conf * 7, c: dir < 0 ? C.dep : C.pur,
      label: short(b.description || ""), kind: dir < 0 ? "departure" : "pursuit",
      font: 11, weight: 600, alpha: 0.4 + conf * 0.6, data: b
    });
  });
  place(arc.departures || [], -1);
  place(arc.pursuits || [], 1);
  return nodes;
}

// A node label is a handle, not the claim. Keep it to a few words on one
// line — the full sentence and its quote live in the panel on click.
function short(s, words=4){
  const w = String(s).replace(/\s+/g," ").trim().split(" ");
  return w.length <= words ? w.join(" ") : w.slice(0, words).join(" ") + "…";
}

function mountArc(canvas, arc, onPick){
  const ctx = canvas.getContext("2d");
  const nodes = buildNodes(arc);
  const edges = nodes.slice(1).map(n => ({a:nodes[0], b:n, c:n.c, o:(n.alpha??1)*0.55}));
  let W=0,H=0,yaw=0.35,pitch=0.22,dist=760,drag=false,lx=0,ly=0,moved=0,hot=null,booted=false;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  function size(){ const d=Math.min(devicePixelRatio||1,2);
    W=canvas.clientWidth; H=canvas.clientHeight;
    canvas.width=W*d; canvas.height=H*d; ctx.setTransform(d,0,0,d,0,0); }
  new ResizeObserver(size).observe(canvas); size();

  function proj(p){
    const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
    let x=p.x*cy-p.z*sy, z=p.x*sy+p.z*cy, y=p.y*cp-z*sp; z=p.y*sp+z*cp;
    const d=dist-z, f=(H*0.85)/Math.max(d,1);
    return {sx:W/2+x*f, sy:H/2-y*f, s:f, d};
  }
  function frame(t){
    requestAnimationFrame(frame);
    if(!drag && !reduced) yaw += 0.0013;
    ctx.clearRect(0,0,W,H); ctx.fillStyle="#0C1017"; ctx.fillRect(0,0,W,H);
    for(const e of edges){
      const A=proj(e.a),B=proj(e.b); if(A.d<=1||B.d<=1) continue;
      const lit = hot && (hot===e.b);
      ctx.globalAlpha = lit?0.95:e.o*(hot?0.25:1);
      ctx.strokeStyle=e.c; ctx.lineWidth=lit?2:1;
      ctx.beginPath(); ctx.moveTo(A.sx,A.sy); ctx.lineTo(B.sx,B.sy); ctx.stroke();
    }
    ctx.globalAlpha=1;
    const drawn = nodes.map(n=>({n,p:proj(n)})).filter(o=>o.p.d>1).sort((a,b)=>b.p.d-a.p.d);
    for(const {n,p} of drawn){
      const lit=(hot===n), dim=hot&&!lit;
      const rad=n.r*p.s*(lit?1.5:1);
      const g=ctx.createRadialGradient(p.sx,p.sy,0,p.sx,p.sy,Math.max(rad*4,2));
      g.addColorStop(0,n.c); g.addColorStop(.22,n.c); g.addColorStop(1,"rgba(0,0,0,0)");
      ctx.globalAlpha=(dim?0.15:(lit?0.5:0.28))*(n.alpha??1);
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(p.sx,p.sy,Math.max(rad*4,2),0,6.284); ctx.fill();
      ctx.globalAlpha=(dim?0.3:1)*(n.alpha??1);
      ctx.fillStyle=n.c; ctx.beginPath(); ctx.arc(p.sx,p.sy,Math.max(rad,1),0,6.284); ctx.fill();
      n._x=p.sx; n._y=p.sy; n._r=Math.max(rad,9);
      const fs=Math.min(n.font*p.s*11,20);
      if(fs>8){
        ctx.globalAlpha=dim?0.25:1;
        ctx.font=`${n.weight} ${fs.toFixed(1)}px "IBM Plex Sans",sans-serif`;
        ctx.textAlign="center"; ctx.textBaseline="bottom";
        ctx.fillStyle = n.kind==="person" ? C.person : C.ink;
        String(n.label).split("\n").forEach((ln,i,a)=>
          ctx.fillText(ln, p.sx, p.sy-rad-7-(a.length-1-i)*fs*1.15));
      }
    }
    ctx.globalAlpha=1;
    if(!booted){ booted=true; canvas.classList.add("ready"); }
  }
  requestAnimationFrame(frame);

  const hit=(mx,my)=>{ let best=null,bd=1e9;
    for(const n of nodes){ if(n._x===undefined) continue;
      const d=Math.hypot(mx-n._x,my-n._y);
      if(d<Math.max(n._r+10,15)&&d<bd){bd=d;best=n;} } return best; };
  canvas.style.cursor="grab";
  canvas.addEventListener("pointerdown",e=>{drag=true;moved=0;lx=e.clientX;ly=e.clientY;canvas.setPointerCapture(e.pointerId);});
  canvas.addEventListener("pointerup",()=>{drag=false;canvas.style.cursor="grab";});
  canvas.addEventListener("pointermove",e=>{
    const r=canvas.getBoundingClientRect();
    if(drag){ moved+=Math.abs(e.clientX-lx)+Math.abs(e.clientY-ly);
      yaw-=(e.clientX-lx)*0.006; pitch=Math.max(-1.2,Math.min(1.2,pitch+(e.clientY-ly)*0.005));
      lx=e.clientX;ly=e.clientY; return; }
    const n=hit(e.clientX-r.left,e.clientY-r.top);
    if(n!==hot){ hot=n; canvas.style.cursor=n?"pointer":"grab"; }
  });
  canvas.addEventListener("click",e=>{ if(moved>=5) return;
    const r=canvas.getBoundingClientRect();
    const n=hit(e.clientX-r.left,e.clientY-r.top); if(n&&onPick) onPick(n); });
  canvas.addEventListener("wheel",e=>{e.preventDefault();
    dist=Math.max(240,Math.min(1400,dist*(1+e.deltaY*0.0012)));},{passive:false});
}
window.mountArc = mountArc;
