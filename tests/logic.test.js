const L=require('../logic.js');
const all=[];for(const s of 'CDHS')for(const r of ['A','2','3','4','5','6','7','8','9','10','J','Q','K'])all.push(r+s);
let fails=0,runs=0;
for(let t=0;t<5000;t++){
  let deck=[...all].sort(()=>Math.random()-.5);
  const drop=Math.floor(Math.random()*20); deck=deck.slice(drop);           // incomplete deck
  const scanned=[...deck];                                                  // face-up spread L->R == top->bottom
  let d=[...deck]; const cuts=1+Math.floor(Math.random()*6);
  for(let c=0;c<cuts;c++){const k=1+Math.floor(Math.random()*(d.length-1)); d=d.slice(k).concat(d.slice(0,k));}
  const pocket=d.shift(); const bottom=d[d.length-1];
  runs++; if(L.pocketCard(scanned,bottom)!==pocket) fails++;
  // reversed spread
  if(L.pocketCard([...scanned].reverse(),bottom,true)!==pocket) fails++;
}
console.log('runs',runs,'fails',fails, L.cardName('AC'), L.cardName('10H'));
console.log(L.orderFromDetections([{cls:'KH',x:248,conf:.9},{cls:'AH',x:127,conf:.88},{cls:'AH',x:600,conf:.3},{cls:'QH',x:425,conf:.8}]));
