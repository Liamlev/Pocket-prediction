// Full live flow with a fake camera: node tests/browser-live.playwright.js path/to/video.y4m
// (serve this folder on :8766 first; make the .y4m with ffmpeg: black lead-in, a pan along a spread, black, then a bottom card).
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--use-file-for-fake-video-capture='+process.argv[2]] });
  const ctx = await b.newContext({ permissions:['camera'], viewport:{width:390,height:844}, deviceScaleFactor:2 }); const p = await ctx.newPage();
  p.on('console', m => { if(m.type()==='error') console.log('console:', m.text()); });
  p.on('pageerror', e => console.log('pageerror', e.message));
  const t0=Date.now();
  await p.goto(process.env.APP_URL || 'http://localhost:8766/'); await p.waitForSelector('#s-home.on',{timeout:180000});
  await p.fill('#deckCount', process.env.DECK || '5'); await p.dispatchEvent('#deckCount','change'); await p.click('#homeScan'); console.log('loaded in', Date.now()-t0,'ms; engine', await p.evaluate(()=>__app.engine));
  let shot=false;
  for(let i=0;i<160;i++){ await p.waitForTimeout(500);
    const s=await p.evaluate(()=>({scr:[...document.querySelectorAll('.screen.on')].map(e=>e.id).join(), count:document.querySelector('#sCount').textContent, msg:document.querySelector('#sMsg').textContent, bar:document.querySelector('#sBar').style.width, wait:document.querySelector('#wait').classList.contains('on'), perf:document.querySelector("#perf").textContent, pend: JSON.stringify(__app.scanner.state(performance.now(),2).pendingCards.map(q=>q.c))}));
    if(i%2==0) console.log(((Date.now()-t0)/1000).toFixed(1)+'s', JSON.stringify(s));
    if(!shot && s.count.startsWith('5')){ await p.screenshot({path:'shot_sweep.png'}); shot=true; }
    if(s.scr==='s-result') break; }
  console.log('order', JSON.stringify(await p.evaluate(()=>__app.order)));
  console.log('RESULT', await p.textContent('#resName'), '|', await p.textContent('#resSub'));
  await p.screenshot({path:'shot_result2.png'});
  await b.close(); })();
