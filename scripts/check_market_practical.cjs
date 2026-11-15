const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:5176';
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({viewport:{width:1440,height:800}}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  const response=page.waitForResponse(r=>r.url().includes('/api/v1/market/hotspots?')&&r.ok());
  await page.goto(base+'/?view=markets',{timeout:90000});const live=await(await response).json();
  await page.locator('.heatmap-grid>button').first().waitFor({timeout:60000});assert.equal(live.market,'CRYPTO');
  assert.equal(await page.getByRole('button',{name:'USDT现货 · 24小时',exact:true}).count(),0);
  const heat=await page.locator('.heatmap-grid em').allTextContents();assert(heat.length&&heat.every(s=>s.endsWith('USDT')));
  assert(live.sectors.every(r=>r.amount>=0));
  const amount=page.getByRole('navigation',{name:'市场排行',exact:true}).getByRole('button',{name:'成交额',exact:true});await amount.click();
  const pane=page.locator('.market-active-ranking');assert.equal(await pane.locator('.mover-rows>button').count(),live.active.length);
  const turnover=await pane.locator('.market-row-amount').allTextContents();assert(turnover.length&&turnover.every(s=>s.endsWith('USDT')));
  await pane.evaluate(el=>el.scrollTop=420);
  const row=pane.locator('.mover-rows>button').nth(10);await row.scrollIntoViewIfNeeded();
  const origin={scroll:await pane.evaluate(el=>el.scrollTop),window:await page.evaluate(()=>scrollY),top:(await row.boundingBox()).y,id:await row.getAttribute('id'),ticker:await row.getAttribute('data-market-ticker')};
  await row.click();await page.getByRole('button',{name:'返回市场',exact:true}).click();await pane.waitFor();
  await page.waitForFunction(({id,scroll})=>document.activeElement?.id===id&&Math.abs(document.querySelector('.market-active-ranking').scrollTop-scroll)<2,origin,{timeout:30000});
  assert.equal(await amount.getAttribute('aria-pressed'),'true');assert(Math.abs((await page.locator('#'+origin.id).boundingBox()).y-origin.top)<2);
  await page.reload();await pane.waitFor();assert.equal(await amount.getAttribute('aria-pressed'),'true');
  await page.waitForFunction(()=>document.querySelectorAll('.market-active-ranking .mover-rows>button').length>0,null,{timeout:60000});
  await page.screenshot({path:process.env.SCREENSHOT_PATH||'reports/market-practical.png'});
  const tiny=await browser.newContext({viewport:{width:1440,height:900}}),tinyPage=await tiny.newPage();tinyPage.on('pageerror',e=>errors.push(e.message));
  await tiny.routeWebSocket('**/ws/stock-updates',s=>s.onMessage(raw=>{if(JSON.parse(raw).type==='ping')s.send('{"type":"pong"}');}));
  const fixture=structuredClone(live);fixture.indices=[{...fixture.indices[0],ticker:'PEPEUSDT',name:'PEPE',price:.00001234}];
  await tinyPage.route('**/api/v1/market/hotspots?*',route=>route.fulfill({json:fixture}));
  await tinyPage.goto(base+'/?view=markets',{timeout:90000});assert.equal(await tinyPage.locator('#market-index-PEPEUSDT strong').innerText(),'0.00001234');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);await tiny.close();
  const report={url:base,realBinanceOverview:true,activePairs:live.active.length,cryptoTurnoverInUsdt:true,liquidityRanking:true,rankingPreferenceSurvivesReload:true,backRestoresNestedScrollAndFocus:true,smallCoinPricePrecision:true,noDuplicateMarketAction:true,noHorizontalOverflow:true,errors};
  fs.writeFileSync(process.env.REPORT_PATH||'reports/market-practical-check.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await context.close();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
