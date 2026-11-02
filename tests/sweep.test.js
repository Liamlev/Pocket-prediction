const L=require('../logic.js');
const all=[];for(const s of 'CDHS')for(const r of ['A','2','3','4','5','6','7','8','9','10','J','Q','K'])all.push(r+s);
function rnd(a,b){return a+Math.random()*(b-a)}
function sim(opt){ const {n=52, neverSeen=null, misread=0.01, miss=0.15, angle=0, endMiss=0}=opt;
  const deck=[...all].sort(()=>Math.random()-.5).slice(0,n);
  const sc=new L.SweepScanner(); let t=0, st;
  const sp=30; // spread units per card
  // sweep window across spread and back, with zoom change and jitter
  const steps=60;
  for(let k=0;k<=steps*1.4;k++){
    t+=80; const u=Math.min(1,k/steps); const center=u*(n*sp), zoom=rnd(2.5,3.5), width=rnd(10,18)*sp;
    const th=angle+rnd(-.05,.05), dets=[];
    deck.forEach((c,i)=>{ const X=i*sp; if(Math.abs(X-center)>width/2) return; if(c===neverSeen) return; if(Math.random()<miss) return; if(i===0 && Math.random()<endMiss) return;
      let cls=c; if(Math.random()<misread) cls=all[Math.floor(Math.random()*52)];
      const lx=(X-center+width/2)*zoom+rnd(-3,3), ly=300+rnd(-8,8);
      dets.push({cls, x: lx*Math.cos(th)-ly*Math.sin(th), y: lx*Math.sin(th)+ly*Math.cos(th), conf:rnd(.5,.95)}); });
    const fw=width*zoom, cs=[[0,0],[fw,0],[0,600],[fw,600]].map(([x,y])=>[x*Math.cos(th)-y*Math.sin(th), x*Math.sin(th)+y*Math.cos(th)]);
    const fr={x0:Math.min(...cs.map(c=>c[0])),x1:Math.max(...cs.map(c=>c[0])),y0:Math.min(...cs.map(c=>c[1])),y1:Math.max(...cs.map(c=>c[1]))};
    sc.addFrame(dets,t,opt.noFrame?null:fr); st=sc.state(t, 2);
    if(st.complete) break;
  }
  const truth=deck.filter(c=>c!==neverSeen);
  return {ok: JSON.stringify(st.order)===JSON.stringify(truth), complete:st.complete, gaps:st.gaps.length, n:st.order.length, truthN:truth.length, ms:t, lost:sc.lostFrames, extra: st.order.filter(c=>!truth.includes(c))};
}
for (const [name,opt] of [['clean 52',{}],['45 cards',{n:45}],['tilted phone',{angle:.5}],['portrait 90deg',{angle:1.5}],['heavy misreads',{misread:.05}],['one card never seen',{neverSeen:'__'}],['end card hard to read',{endMiss:.85}]]){
  let ok=0,comp=0,gap=0,extra=0,ms=0; const R=200;
  for(let i=0;i<R;i++){ const o={...opt}; let r;
    if(o.neverSeen){ r=(()=>{ const s=sim({...o, neverSeen:null}); return s; })(); }
    r=sim(o.neverSeen? {...o, neverSeen: undefined}: o);
    ok+=r.ok; comp+=r.complete; gap+=r.gaps>0; extra+=r.extra.length>0; ms+=r.ms; }
  console.log(name.padEnd(20),'correct order',ok/R,'completed',comp/R,'had gaps',gap/R,'had bogus card',extra/R,'avg ms',Math.round(ms/R));
}
// Missing-card detection: hide one card in the middle
let flagged=0, falseComplete=0; const R=200;
for(let i=0;i<R;i++){
  const deck=[...all].sort(()=>Math.random()-.5);
  const hide=deck[20+Math.floor(Math.random()*12)];
  // reuse sim by monkeypatch
  const sc=new L.SweepScanner(); let t=0, st; const sp=30,n=52;
  for(let k=0;k<=84;k++){ t+=80; const u=Math.min(1,k/60), center=u*n*sp, zoom=3, width=14*sp, dets=[];
    deck.forEach((c,j)=>{const X=j*sp; if(Math.abs(X-center)>width/2||c===hide||Math.random()<.15)return; dets.push({cls:c,x:(X-center+width/2)*zoom,y:300,conf:.8});});
    sc.addFrame(dets,t,{x0:0,y0:0,x1:width*zoom,y1:600}); st=sc.state(t, 2); if(st.complete) break; }
  if(st.gaps.length) flagged++; if(st.complete) falseComplete++;
}
console.log('hidden card: gap flagged',flagged/R,'wrongly said complete',falseComplete/R);

// Sweep that stops short of the end: must NOT complete.
{ let falseC=0; const R=200;
  for(let i=0;i<R;i++){ const deck=[...all].sort(()=>Math.random()-.5); const sc=new L.SweepScanner(); let t=0,st; const sp=30,n=52;
    for(let k=0;k<=120;k++){ t+=80; const u=Math.min(0.8,k/60), center=u*n*sp, zoom=3, width=14*sp, dets=[];
      deck.forEach((c,j)=>{const X=j*sp; if(Math.abs(X-center)>width/2||Math.random()<.15)return; dets.push({cls:c,x:(X-center+width/2)*zoom,y:300,conf:.8});});
      sc.addFrame(dets,t,{x0:0,y0:0,x1:width*zoom,y1:600}); st=sc.state(t,2); if(st.complete) break; }
    if(st.complete) falseC++; }
  console.log('stopped before the end (any deck size): wrongly said complete', falseC/R); }
