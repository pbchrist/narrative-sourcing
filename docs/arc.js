"use strict";
/* The arc as a navigable map.
 *
 * Three things carry meaning, and all three are labelled on screen, because a
 * chart whose encoding you have to guess is decoration:
 *
 *   ANGLE     left of centre is what they left, right is what they reach for.
 *   DISTANCE  how well evidenced the claim is. Inner ring = the profile says
 *             it plainly; outer ring = the model is reaching. A thin read
 *             literally sits further from the person.
 *   SIZE      the same confidence, so a weak claim is small and far.
 *
 * You can also add your own nodes and connections. Those are drawn dashed and
 * in a different colour and never counted in the confidence score, because the
 * whole point of this tool is that an evidenced claim and a hunch must never
 * look alike.
 */
const C = {
  person:"#F1580A", dep:"#FF6B57", pur:"#3FE0C4",
  mine:"#C9A227", ink:"#E7ECF3", dim:"#7C8FA3", grid:"#22303F"
};
const RINGS = [
  {r:210, label:"stated plainly"},
  {r:310, label:"implied"},
  {r:410, label:"inferred"},
];

function short(s, words=4){
  const w=String(s).replace(/\s+/g," ").trim().split(" ");
  return w.length<=words ? w.join(" ") : w.slice(0,words).join(" ")+"…";
}

function buildNodes(arc){
  const nodes=[{x:0,y:0,z:0,r:13,c:C.person,kind:"person",
                label:"THE PERSON", full:arc.throughline||"", quote:"",
                font:13, weight:700, lift:1, data:arc}];
  const place=(beats,dir)=>beats.forEach((b,i)=>{
    const conf=Math.max(0.15,Math.min(1,b.confidence??0.5));
    const R=200+(1-conf)*220;                 // less certain, further out
    const n=beats.length, t=n>1?(i/(n-1)-0.5):0;
    const ang=t*1.45;
    // The vertical span has to grow with the cast. Fixed at 200 it was fine
    // for the two or three claims that used to survive and became a stack of
    // unreadable labels the moment a full career came through.
    const spread=Math.max(200, n*54);
    nodes.push({
      x:dir*Math.cos(ang)*R, y:t*spread, z:Math.sin(ang)*R*0.7,
      r:6+conf*6, c:dir<0?C.dep:C.pur,
      kind:dir<0?"departure":"pursuit",
      label:short(b.description||""), full:b.description||"",
      quote:b.evidence||"", conf, lift:(i%2===0)?1:-1,
      font:11, weight:600, alpha:0.45+conf*0.55, data:b
    });
  });
  place(arc.departures||[],-1);
  place(arc.pursuits||[],1);
  return nodes;
}

function mountArc(canvas, arc, onPick){
  const ctx=canvas.getContext("2d");
  const KEY="ns.mine."+(arc.throughline||"").slice(0,40);
  const nodes=buildNodes(arc);
  const base=nodes.length;
  const edges=nodes.slice(1).map(n=>({a:0,b:nodes.indexOf(n),c:n.c,o:(n.alpha??1)*0.5,mine:false}));

  // ---- anything the user adds, restored across reloads ----------------------
  try{
    const saved=JSON.parse(localStorage.getItem(KEY)||"{}");
    (saved.nodes||[]).forEach(n=>nodes.push({...n,c:C.mine,kind:"mine",
      r:8,font:11,weight:600,alpha:1,lift:1,label:short(n.full||"",4)}));
    (saved.edges||[]).forEach(e=>{
      if(e.a<nodes.length&&e.b<nodes.length) edges.push({...e,c:C.mine,o:0.85,mine:true});
    });
  }catch{}
  const save=()=>{
    try{
      localStorage.setItem(KEY,JSON.stringify({
        nodes:nodes.slice(base).map(n=>({x:n.x,y:n.y,z:n.z,full:n.full,mine:true})),
        edges:edges.filter(e=>e.mine).map(e=>({a:e.a,b:e.b,mine:true}))
      }));
    }catch{}
  };

  let W=0,H=0,yaw=0.30,pitch=0.20,dist=560;
  let drag=false,lx=0,ly=0,moved=0,hot=null,link=null,booted=false,mx=0,my=0;
  let over=false, focused=-1;
  const reduced=matchMedia("(prefers-reduced-motion: reduce)").matches;

  function size(){const d=Math.min(devicePixelRatio||1,2);
    W=canvas.clientWidth;H=canvas.clientHeight;
    canvas.width=W*d;canvas.height=H*d;ctx.setTransform(d,0,0,d,0,0);}
  new ResizeObserver(size).observe(canvas); size();

  function proj(p){
    const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
    let x=p.x*cy-p.z*sy, z=p.x*sy+p.z*cy, y=p.y*cp-z*sp; z=p.y*sp+z*cp;
    const d=dist-z, f=(H*0.82)/Math.max(d,1);
    return {sx:W/2+x*f, sy:H/2-y*f, s:f, d};
  }
  // screen point -> a world point on the y=0 plane, for placing new nodes
  function unproj(sx,sy){
    const f=(H*0.82)/dist, x2=(sx-W/2)/f, y2=-(sy-H/2)/f;
    const cy=Math.cos(-yaw),sy2=Math.sin(-yaw);
    return {x:x2*cy, y:y2, z:x2*sy2};
  }

  function ringsAndAxes(){
    ctx.save();
    ctx.setLineDash([2,6]); ctx.strokeStyle=C.grid; ctx.lineWidth=1;
    for(const ring of RINGS){
      ctx.beginPath();
      for(let i=0;i<=64;i++){
        const a=i/64*Math.PI*2;
        const p=proj({x:Math.cos(a)*ring.r,y:0,z:Math.sin(a)*ring.r});
        i?ctx.lineTo(p.sx,p.sy):ctx.moveTo(p.sx,p.sy);
      }
      ctx.stroke();
      const lab=proj({x:0,y:0,z:ring.r});
      ctx.setLineDash([]);
      ctx.font='9px "IBM Plex Mono",monospace'; ctx.fillStyle=C.dim;
      ctx.textAlign="center"; ctx.textBaseline="middle";
      ctx.globalAlpha=.65; ctx.fillText(ring.label,lab.sx,lab.sy); ctx.globalAlpha=1;
      ctx.setLineDash([2,6]);
    }
    ctx.restore();
    ctx.save();
    ctx.font='10px "IBM Plex Mono",monospace'; ctx.textBaseline="middle";
    ctx.fillStyle=C.dep; ctx.textAlign="left";  ctx.fillText("← WHAT THEY LEFT",14,18);
    ctx.fillStyle=C.pur; ctx.textAlign="right"; ctx.fillText("WHAT THEY REACH FOR →",W-14,18);
    ctx.fillStyle=C.dim; ctx.textAlign="center";
    ctx.fillText("distance from centre = how well evidenced",W/2,H-14);
    ctx.restore();
  }

  function card(n,px,py){
    const pad=12, maxw=Math.min(330,W-40);
    ctx.font='600 12.5px "IBM Plex Sans",sans-serif';
    const lines=wrapText(n.full||n.label,maxw-pad*2,'600 12.5px "IBM Plex Sans",sans-serif');
    let qlines=[];
    if(n.quote) qlines=wrapText('"'+n.quote+'"',maxw-pad*2,'11.5px "IBM Plex Mono",monospace');
    const h=pad*2+lines.length*17+(qlines.length?10+qlines.length*15:0)+(n.conf!=null?18:0);
    let x=Math.min(Math.max(px+16,10),W-maxw-10), y=Math.min(Math.max(py-h/2,10),H-h-10);
    ctx.fillStyle="rgba(14,20,30,.97)"; ctx.strokeStyle=n.c; ctx.lineWidth=1;
    ctx.beginPath(); ctx.rect(x,y,maxw,h); ctx.fill(); ctx.stroke();
    let ty=y+pad+4;
    ctx.fillStyle=C.ink; ctx.font='600 12.5px "IBM Plex Sans",sans-serif';
    ctx.textAlign="left"; ctx.textBaseline="top";
    lines.forEach(l=>{ctx.fillText(l,x+pad,ty);ty+=17;});
    if(qlines.length){
      ty+=6; ctx.fillStyle=n.c; ctx.font='11.5px "IBM Plex Mono",monospace';
      qlines.forEach(l=>{ctx.fillText(l,x+pad,ty);ty+=15;});
    }
    if(n.conf!=null){
      ty+=4; ctx.fillStyle=C.dim; ctx.font='9.5px "IBM Plex Mono",monospace';
      ctx.fillText("confidence "+n.conf.toFixed(2),x+pad,ty);
    }
  }
  function wrapText(s,max,font){
    ctx.font=font; const out=[]; let cur="";
    for(const w of String(s).split(" ")){
      const t=cur?cur+" "+w:w;
      if(ctx.measureText(t).width>max&&cur){out.push(cur);cur=w;} else cur=t;
    }
    if(cur)out.push(cur);
    return out.slice(0,8);
  }

  function frame(){
    requestAnimationFrame(frame);
    // Stops spinning while you read, and also while you are on your way: a
    // target that drifts out from under the cursor as you approach it is the
    // whole of why these were hard to hit.
    if(!drag&&!reduced&&!hot&&!over&&focused<0) yaw+=0.0011;
    ctx.clearRect(0,0,W,H); ctx.fillStyle="#0C1017"; ctx.fillRect(0,0,W,H);
    ringsAndAxes();

    for(const e of edges){
      const A=proj(nodes[e.a]),B=proj(nodes[e.b]);
      if(A.d<=1||B.d<=1)continue;
      const lit=hot&&(nodes[e.a]===hot||nodes[e.b]===hot);
      ctx.save();
      if(e.mine)ctx.setLineDash([5,4]);
      ctx.globalAlpha=lit?.95:e.o*(hot?.22:1);
      ctx.strokeStyle=e.c; ctx.lineWidth=lit?2:1;
      ctx.beginPath();ctx.moveTo(A.sx,A.sy);ctx.lineTo(B.sx,B.sy);ctx.stroke();
      ctx.restore();
    }
    if(link){
      const A=proj(nodes[link]);
      ctx.save();ctx.setLineDash([4,4]);ctx.strokeStyle=C.mine;ctx.globalAlpha=.9;
      ctx.beginPath();ctx.moveTo(A.sx,A.sy);ctx.lineTo(mx,my);ctx.stroke();ctx.restore();
    }

    const drawn=nodes.map(n=>({n,p:proj(n)})).filter(o=>o.p.d>1).sort((a,b)=>b.p.d-a.p.d);
    // Where a label has already been written. A label drawn over another one
    // is worse than no label: both become unreadable, and the reader cannot
    // tell which node either belongs to.
    const taken=[];
    const clear=(b)=>!taken.some(t=>b.x0<t.x1&&b.x1>t.x0&&b.y0<t.y1&&b.y1>t.y0);
    for(const {n,p} of drawn){
      const lit=hot===n, dim=hot&&!lit;
      const rad=n.r*p.s*(lit?1.45:1);
      const g=ctx.createRadialGradient(p.sx,p.sy,0,p.sx,p.sy,Math.max(rad*4,2));
      g.addColorStop(0,n.c);g.addColorStop(.22,n.c);g.addColorStop(1,"rgba(0,0,0,0)");
      ctx.globalAlpha=(dim?.12:(lit?.5:.26))*(n.alpha??1);
      ctx.fillStyle=g;ctx.beginPath();ctx.arc(p.sx,p.sy,Math.max(rad*4,2),0,6.284);ctx.fill();
      ctx.globalAlpha=dim?.3:1;
      if(n.kind==="mine"){
        ctx.setLineDash([3,3]);ctx.strokeStyle=n.c;ctx.lineWidth=1.6;
        ctx.beginPath();ctx.arc(p.sx,p.sy,Math.max(rad,3),0,6.284);ctx.stroke();ctx.setLineDash([]);
      }else{
        ctx.fillStyle=n.c;ctx.beginPath();ctx.arc(p.sx,p.sy,Math.max(rad,1),0,6.284);ctx.fill();
      }
      n._x=p.sx;n._y=p.sy;n._r=Math.max(rad,10);
      const fs=Math.min(n.font*p.s*11,19);
      if(fs>8&&!lit){
        ctx.globalAlpha=dim?.22:1;
        ctx.font=`${n.weight} ${fs.toFixed(1)}px "IBM Plex Sans",sans-serif`;
        ctx.textAlign="center";
        const up=(n.lift??1)>0; ctx.textBaseline=up?"bottom":"top";
        ctx.fillStyle=n.kind==="person"?C.person:(n.kind==="mine"?C.mine:C.ink);
        const half=ctx.measureText(n.label).width/2+8;
        const cx=Math.max(half,Math.min(W-half,p.sx));
        const h=fs*1.15;
        // Step away from the node until the line is clear, first the way it
        // wanted to go, then the other way. If nothing is free it is dropped
        // rather than stacked - the dot is still there to hover.
        let y=null;
        for(const dir of up?[-1,1]:[1,-1]){
          for(let k=0;k<9;k++){
            const ty=p.sy+dir*(rad+9+k*(h+3));
            const b={x0:cx-half,x1:cx+half,
                     y0:dir<0?ty-h:ty, y1:dir<0?ty:ty+h};
            if(b.y0<4||b.y1>H-24) break;
            if(clear(b)){ y=ty; ctx.textBaseline=dir<0?"bottom":"top"; taken.push(b); break; }
          }
          if(y!==null) break;
        }
        if(y!==null){
          ctx.fillText(n.label,cx,y);
          // The label is the thing a reader aims at - it is the part they can
          // actually see and read. Aiming at it and getting nothing, while a
          // nine-pixel dot beside it is the real target, is the interface
          // disagreeing with itself.
          const top = ctx.textBaseline==="bottom" ? y-h : y;
          n._lab = {x0:cx-half, x1:cx+half, y0:top, y1:top+h};
        } else n._lab = null;
      }
    }
    ctx.globalAlpha=1;
    if(hot) card(hot,hot._x,hot._y);              // full text on hover, no "…"
    if(!booted){booted=true;canvas.classList.add("ready");}
  }
  requestAnimationFrame(frame);

  const hit=(x,y)=>{let best=null,bd=1e9;
    for(const n of nodes){if(n._x===undefined)continue;
      const d=Math.hypot(x-n._x,y-n._y);
      if(d<Math.max(n._r+10,16)&&d<bd){bd=d;best=n;}}
    // Nothing under the dot: try the words. A label is a far bigger target
    // than the node it names, and it is the one people aim for.
    if(!best) for(const n of nodes){
      const b=n._lab;
      if(b&&x>=b.x0&&x<=b.x1&&y>=b.y0&&y<=b.y1){best=n;break;}}
    return best;};
  const rel=e=>{const r=canvas.getBoundingClientRect();return[e.clientX-r.left,e.clientY-r.top];};

  canvas.style.cursor="grab";
  canvas.addEventListener("pointerdown",e=>{
    const [x,y]=rel(e); const n=hit(x,y);
    if(e.shiftKey&&n){ link=nodes.indexOf(n); return; }   // shift-drag = connect
    drag=true;moved=0;lx=e.clientX;ly=e.clientY;canvas.setPointerCapture(e.pointerId);
  });
  // Keyboard, because a map you can only reach with a mouse is a map some
  // people cannot read at all - and every claim in it is also written out in
  // the two lists underneath, which is where a screen reader is sent.
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "application");
  canvas.setAttribute("aria-label",
    "Career map. Arrow keys or Tab move between claims, Enter opens one, "
    + "Escape closes it. Every claim here is also listed as text below the map.");

  const focusNode = i => {
    // Ordinarily only what has been drawn can be reached, so the order matches
    // what is on screen. But nothing is drawn until a frame runs, and a frame
    // does not run in a background tab or before the first paint - and a
    // keyboard user who arrives first should not find an inert map.
    let live = nodes.filter(n => n._x !== undefined);
    if(!live.length) live = nodes.slice();
    if(!live.length) return;
    focused = (i + live.length) % live.length;
    hot = live[focused];
    if(onPick) onPick(hot);
  };
  canvas.addEventListener("keydown", e => {
    if(e.key === "Escape"){ hot = null; focused = -1; canvas.blur(); return; }
    if(e.key === "ArrowRight" || e.key === "ArrowDown"){ focusNode(focused + 1); e.preventDefault(); return; }
    if(e.key === "ArrowLeft"  || e.key === "ArrowUp"){   focusNode(focused - 1); e.preventDefault(); return; }
    if(e.key === "Enter" || e.key === " "){
      if(focused < 0) focusNode(0); else if(hot && onPick) onPick(hot);
      e.preventDefault();
    }
  });
  canvas.addEventListener("focus", () => { if(focused < 0) focusNode(0); });
  canvas.addEventListener("blur",  () => { if(!over){ hot = null; focused = -1; } });
  canvas.addEventListener("pointerenter", () => { over = true; });
  canvas.addEventListener("pointerleave", () => { over = false; });

  canvas.addEventListener("pointermove",e=>{
    const [x,y]=rel(e); mx=x;my=y;
    if(drag){moved+=Math.abs(e.clientX-lx)+Math.abs(e.clientY-ly);
      yaw-=(e.clientX-lx)*0.006;pitch=Math.max(-1.2,Math.min(1.2,pitch+(e.clientY-ly)*0.005));
      lx=e.clientX;ly=e.clientY;return;}
    const n=hit(x,y);
    if(n!==hot){hot=n;canvas.style.cursor=n?"pointer":"grab";}
  });
  canvas.addEventListener("pointerup",e=>{
    const [x,y]=rel(e);
    if(link!==null){
      const n=hit(x,y), i=nodes.indexOf(n);
      if(n&&i!==link){edges.push({a:link,b:i,c:C.mine,o:.85,mine:true});save();}
      link=null; return;
    }
    drag=false;canvas.style.cursor="grab";
  });
  canvas.addEventListener("click",e=>{
    if(moved>=5)return;
    const [x,y]=rel(e); const n=hit(x,y);
    if(n){ if(onPick)onPick(n); return; }
    const text=prompt("Add your own node — what do you want to remember about this person?");
    if(!text)return;
    const w=unproj(x,y);
    nodes.push({...w,r:8,c:C.mine,kind:"mine",label:short(text,4),full:text,quote:"",
                font:11,weight:600,alpha:1,lift:1});
    save();
  });
  canvas.addEventListener("dblclick",e=>{
    const [x,y]=rel(e); const n=hit(x,y);
    if(n&&n.kind==="mine"){
      const i=nodes.indexOf(n);
      nodes.splice(i,1);
      for(let k=edges.length-1;k>=0;k--){
        const ed=edges[k];
        if(ed.a===i||ed.b===i)edges.splice(k,1);
        else{if(ed.a>i)ed.a--; if(ed.b>i)ed.b--;}
      }
      hot=null;save();
    }
  });
  canvas.addEventListener("wheel",e=>{e.preventDefault();
    dist=Math.max(240,Math.min(1500,dist*(1+e.deltaY*0.0012)));},{passive:false});
}
window.mountArc = mountArc;
