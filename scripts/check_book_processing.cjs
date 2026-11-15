const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs');
const base=process.env.PREVIEW_URL||'https://stock-dashboard-web-rf7v.onrender.com';
const stats=list=>{const a=[...list].sort((a,b)=>a-b);return a.length?{count:a.length,p50:+a[Math.floor(a.length*.5)].toFixed(1),p95:+a[Math.floor(a.length*.95)].toFixed(1),max:+a.at(-1).toFixed(1)}:{count:0};};
const gaps=a=>a.slice(1).map((v,i)=>v-a[i]);
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),outside=[];
 page.on('websocket',s=>s.on('framereceived',f=>{try{const m=JSON.parse(String(f.payload));if(m.type==='depth')outside.push({seq:m.data.sequence,time:Date.now()});}catch{}}));
 try{
  await page.addInitScript(()=>{
   window.bookProcessing={inside:[],long:[]};new PerformanceObserver(list=>{window.bookProcessing.long.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})));}).observe({type:'longtask',buffered:true});
   const Original=window.WebSocket;window.WebSocket=class extends Original{constructor(...args){super(...args);this.addEventListener('message',e=>{try{const m=JSON.parse(e.data);if(m.type==='depth')window.bookProcessing.inside.push({seq:m.data.sequence,time:Date.now()});}catch{}});}};
  });
  await page.goto(base+'/?view=overview&market=CRYPTO&ticker=BTCUSDT&period=1d&chart=candles&interval=1m',{timeout:90000});
  await page.waitForFunction(()=>document.querySelector('.order-book')?.dataset.depthSequence,null,{timeout:90000});
  const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  await page.waitForTimeout(3000);outside.length=0;await page.evaluate(()=>{window.bookProcessing.inside=[];window.bookProcessing.long=[];});
  await page.waitForTimeout(20000);const inside=await page.evaluate(()=>window.bookProcessing),map=new Map(outside.map(e=>[e.seq,e.time]));
  const lags=inside.inside.filter(e=>map.has(e.seq)).map(e=>e.time-map.get(e.seq));
  const report={url:base,cpuThrottle:4,seconds:20,protocolFrameGaps:stats(gaps(outside.map(e=>e.time))),pageDeliveryGaps:stats(gaps(inside.inside.map(e=>e.time))),pageMinusProtocolMs:stats(lags),longTasks:stats(inside.long.map(e=>e.duration)),longTaskTotalMs:inside.long.reduce((s,e)=>s+e.duration,0)};
  fs.writeFileSync(process.env.REPORT_PATH||'reports/book-processing-check.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await context.close();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
