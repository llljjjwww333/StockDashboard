const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:5176';
(async()=>{
 const {createPortfolio,executePortfolioOrder,bindStockStrategy,defaultMandate}=await import('../frontend/src/terminal/portfolio.ts');
 const {strategyDefaults,runBacktest}=await import('../frontend/src/terminal/backtest.ts');
 const {defaultCustomRules}=await import('../frontend/src/terminal/strategyRules.ts');
 const {editStrategyExecution}=await import('../frontend/src/terminal/strategyDefinition.ts');
 const {filterPortfolioOrders}=await import('../frontend/src/terminal/portfolioActivityData.ts');
 const {formatTradingQuantity}=await import('../frontend/src/lib/tradingNumber.ts');
 const instrument={ticker:'BTCUSDT',name:'Bitcoin',market:'CRYPTO'},stamp=()=>new Date().toISOString();
 const config={...strategyDefaults,kind:'custom',rules:defaultCustomRules(),positionPct:20,capital:100,sessionsPerYear:365};config.rules.entry.conditions[0].right.period=37;
 const bound=editStrategyExecution({...defaultMandate,id:'shared-source',name:'已绑定版本',goal:'原始目标',instrument,maxSingle:20,maxGross:20,news:false},instrument,config,true);
 const current=editStrategyExecution({...bound,name:'库中较新版本'},instrument,{...config,rules:{...config.rules,entry:{...config.rules.entry,conditions:[{...config.rules.entry.conditions[0],right:{indicator:'sma',period:73}}]}}});
 const draft=editStrategyExecution(current,instrument,{...current.execution,rules:{...current.execution.rules,entry:{...current.execution.rules.entry,conditions:[{...current.execution.rules.entry.conditions[0],right:{indicator:'sma',period:91}}]}}});
 const binding={ticker:'BTCUSDT',name:'Bitcoin',label:bound.name,mode:'rules',mandate:bound,config:bound.execution,profileId:'',allocationPct:10,enabled:false};
 const quote=ticker=>({ticker,price:ticker==='SHIBUSDT'?.00001867:100,volume:1000,change_percent:0,source:'browser-fixture',as_of:stamp()});
 let account=createPortfolio('记录核对',10000,'CRYPTO');
 for(let i=0;i<125;i++){
  const side=i%2?'sell':'buy',strategy=i%2?'Beta':'Alpha';
  if(i%7===0)account.orders.push({id:'rejected-'+i,time:stamp(),ticker:'BTCUSDT',side,quantity:.001,status:'rejected',reason:'risk limit',strategy});
  else{const effective=side==='sell'&&!account.positions.length?'buy':side;account=executePortfolioOrder(account,'BTCUSDT',effective,.001,quote('BTCUSDT'),'rebalance','Bitcoin');account.orders.at(-1).strategy=strategy;}
 }
 account=bindStockStrategy(account,binding);
 account.reviews=Array.from({length:65},(_,i)=>({id:'review-'+i,ticker:'BTCUSDT',strategy:i%3?'Beta':'Alpha',reviewed_at:stamp(),provider:'规则引擎',model:'custom',execution:'未下单',decision:{regime:'trend',method:'rule',summary:'decision '+i,reconsider_when:'下一日线',targets:[{ticker:'BTCUSDT',weight_pct:20,reason:'momentum '+i}],evidence_ids:['H1']},evidence:[{id:'H1',title:'history',source:'fixture',timestamp:stamp()}]}));
 const second=createPortfolio('空账户',1000,'CRYPTO'),browser=await chromium.launch({channel:'msedge',headless:true}),contexts=[],errors=[];let aiCalls=0;
 const bars=Array.from({length:300},(_,i)=>{const d=new Date();d.setUTCHours(0,0,0,0);d.setUTCDate(d.getUTCDate()-300+i);const c=100000+i*100;return {timestamp:d.toISOString(),open:c,high:c+100,low:c-100,close:c,volume:1000};});
 const snapshot={version:2,id:'quantity-backtest',name:'小额BTC回测',createdAt:stamp(),instrument,config:draft.execution,period:'1y',source:'browser-fixture',adjustment:'none',stale:false,bars,strategy:{id:draft.id,revision:draft.revision,goal:draft.goal,executionMode:'rules'}};
 const expectedResult=runBacktest(bars,draft.execution);
 async function setup(accounts,withStrategy=true){
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});contexts.push(context);const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(({accounts,current,draft,snapshot,withStrategy})=>{
   if(localStorage.getItem('activity-seeded'))return;
   localStorage.setItem('marketdesk:crypto:portfolios:v2',JSON.stringify(accounts));localStorage.setItem('marketdesk:crypto:selected-portfolio:v2',accounts[0].id);
   localStorage.setItem('marketdesk:ai-profiles:v1',JSON.stringify({profiles:[],activeId:''}));
   if(withStrategy){localStorage.setItem('marketdesk:crypto:portfolio-strategies:v1',JSON.stringify([current]));localStorage.setItem('marketdesk:crypto:strategy-editor-drafts:v1',JSON.stringify([draft]));localStorage.setItem('marketdesk:crypto:selected-strategy:v1',draft.id);localStorage.setItem('marketdesk:crypto:strategy-library:v2',JSON.stringify([snapshot]));}
   localStorage.setItem('activity-seeded','yes');
  },{accounts,current,draft,snapshot,withStrategy});
  await context.routeWebSocket('**/ws/stock-updates',s=>s.onMessage(raw=>{if(JSON.parse(raw).type==='ping')s.send('{"type":"pong"}');}));
  await page.route('**/api/v1/**',route=>{
   const u=new URL(route.request().url()),path=u.pathname;if(path.includes('/ai/')&&route.request().method()==='POST')aiCalls++;
   const json=path.endsWith('/quotes')?{quotes:(u.searchParams.get('tickers')||'').split(',').filter(Boolean).map(quote)}:path.endsWith('/quote')?quote(path.split('/').at(-2)):path.endsWith('/history')?{data:bars,interval:'1d',source:'browser-fixture',adjustment:'none',price_type:'ohlc',fetched_at:stamp()}:{results:[],items:[],sources:[]};
   return route.fulfill({json});
  });
  await page.goto(base+'/?view=simulation',{timeout:90000});await page.getByRole('button',{name:'管理账户',exact:true}).waitFor();return page;
 }
 try{
  const page=await setup([account,second]),nav=page.locator('.portfolio-ledger>nav');
  await nav.getByRole('button',{name:/^委托与成交/}).click();const orders=page.getByRole('region',{name:'委托记录',exact:true});
  assert.equal(await orders.locator('tbody tr').count(),50);const newest=await orders.locator('tbody tr').first().getAttribute('data-order-id');
  await page.getByRole('button',{name:'下一页模拟记录',exact:true}).click();assert.notEqual(await orders.locator('tbody tr').first().getAttribute('data-order-id'),newest);
  await page.getByLabel('模拟记录每页条数',{exact:true}).selectOption('20');assert.equal(await orders.locator('tbody tr').count(),20);
  await page.getByLabel('筛选委托记录',{exact:true}).fill('Alpha');await page.getByLabel('委托方向',{exact:true}).selectOption('buy');await page.getByLabel('委托状态',{exact:true}).selectOption('filled');
  const filtered=filterPortfolioOrders(account.orders,{query:'Alpha',side:'buy',status:'filled'});assert(filtered.length>20);
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出筛选记录 CSV',exact:true}).click();const csv=fs.readFileSync(await(await download).path(),'utf8');assert.equal(csv.trim().split('\r\n').length,filtered.length+1);
  await page.locator('.portfolio-ledger').evaluate(el=>el.scrollIntoView({block:'start',behavior:'instant'}));
  assert((await nav.boundingBox()).y>=72);
  await page.evaluate(()=>scrollBy(0,350));await page.waitForTimeout(100);assert(Math.abs((await page.locator('.portfolio-activity-pages').boundingBox()).y-72)<2);
  await page.locator('.portfolio-ledger').evaluate(el=>el.scrollIntoView({block:'start',behavior:'instant'}));
  await page.screenshot({path:process.env.SCREENSHOT_PATH||'reports/activity-orders.png'});
  await page.getByLabel('筛选委托记录',{exact:true}).fill('missing-record');await page.getByText('没有匹配的委托',{exact:true}).waitFor();assert(await page.getByRole('button',{name:'导出筛选记录 CSV',exact:true}).isDisabled());
  await page.getByLabel('资金账户',{exact:true}).selectOption(second.id);await page.getByText('暂无委托',{exact:true}).waitFor();assert.equal(await page.getByLabel('筛选委托记录',{exact:true}).inputValue(),'');
  await page.getByLabel('资金账户',{exact:true}).selectOption(account.id);assert.equal(await orders.locator('tbody tr').count(),50);
  await nav.getByRole('button',{name:/^决策/}).click();assert.equal(await page.locator('.portfolio-decisions>article').count(),20);
  const firstDecision=await page.locator('.portfolio-decisions>article').first().getAttribute('data-review-id');await page.getByRole('button',{name:'下一页模拟记录',exact:true}).click();assert.notEqual(await page.locator('.portfolio-decisions>article').first().getAttribute('data-review-id'),firstDecision);
  await page.getByLabel('筛选决策记录',{exact:true}).fill('Alpha');assert.equal(await page.locator('.portfolio-decisions>article').count(),20);await page.getByLabel('模拟记录每页条数',{exact:true}).selectOption('50');assert.equal(await page.locator('.portfolio-decisions>article').count(),22);
  await nav.getByRole('button',{name:/^币种策略/}).click();const savedBefore=await page.evaluate(()=>({library:localStorage.getItem('marketdesk:crypto:portfolio-strategies:v1'),drafts:localStorage.getItem('marketdesk:crypto:strategy-editor-drafts:v1')}));
  await page.getByRole('button',{name:'查看参数',exact:true}).click();const modal=page.getByRole('dialog',{name:'执行参数快照',exact:true});
  assert((await modal.innerText()).includes('37 个交易日'));assert((await modal.innerText()).includes('实际执行上限'));assert((await modal.innerText()).includes('执行信号时的有效报价'));assert(!(await modal.innerText()).includes('下一交易日开盘成交'));assert((await modal.innerText()).includes('参数版本 V1'));
  assert.deepEqual(await page.evaluate(()=>({library:localStorage.getItem('marketdesk:crypto:portfolio-strategies:v1'),drafts:localStorage.getItem('marketdesk:crypto:strategy-editor-drafts:v1')})),savedBefore);
  await page.screenshot({path:process.env.SNAPSHOT_SCREENSHOT_PATH||'reports/activity-snapshot.png'});
  await page.getByRole('button',{name:'复制为新策略',exact:true}).click();await page.getByLabel('策略名称',{exact:true}).waitFor();assert.equal(await page.getByLabel('买入规则 1 右值 周期',{exact:true}).inputValue(),'37');
  const after=await page.evaluate(()=>({library:JSON.parse(localStorage.getItem('marketdesk:crypto:portfolio-strategies:v1')),drafts:JSON.parse(localStorage.getItem('marketdesk:crypto:strategy-editor-drafts:v1')),selected:localStorage.getItem('marketdesk:crypto:selected-strategy:v1')}));
  assert.notEqual(after.selected,draft.id);assert.equal(after.library[0].execution.rules.entry.conditions[0].right.period,73);assert.equal(after.drafts.find(s=>s.id===draft.id).execution.rules.entry.conditions[0].right.period,91);
  assert.equal(await page.getByLabel('策略复核间隔',{exact:true}).isVisible(),false);await page.getByText('AI动态模式设置',{exact:true}).click();assert.equal(await page.getByLabel('策略复核间隔',{exact:true}).isVisible(),true);
  const tiny=executePortfolioOrder(createPortfolio('精度核对',10000,'CRYPTO'),'SHIBUSDT','buy',.001,quote('SHIBUSDT'),'fixture','SHIB');tiny.poolMode='custom';tiny.pool=[{ticker:'SHIBUSDT',name:'SHIB',market:'CRYPTO'}];
  const precision=await setup([tiny],false);await precision.waitForFunction(()=>document.querySelector('.manual-quote>strong')?.textContent==='0.00001867');
  await precision.getByLabel('手动委托数量',{exact:true}).fill('0.00000001');assert.equal(await precision.locator('.manual-amount b').innerText(),'<0.00000001');
  const backtest=await setup([second]);await backtest.goto(base+'/?view=strategy',{timeout:90000});await backtest.getByRole('button',{name:'回测',exact:true}).click();await backtest.getByRole('button',{name:'保存结果',exact:true}).waitFor();
  await backtest.locator('.strategy-tabs').getByRole('button',{name:'账户',exact:true}).click();const quantity=await backtest.locator('.strategy-account>span').filter({hasText:'持仓数量'}).locator('b').innerText();assert(expectedResult.shares>0&&expectedResult.shares<.005);assert.equal(quantity,formatTradingQuantity(expectedResult.shares,'zh-CN'));
  assert.equal(aiCalls,0);assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const report={url:base,fixtures:true,ledgerScrollKeepsControlsBelowHeader:true,pagerRemainsVisibleWhileScrolling:true,ordersAndDecisionsPaginated:true,combinedFiltersWork:true,csvIncludesAllFilteredPages:true,accountSwitchResetsFilters:true,simulationTimingIsExplicit:true,snapshotDoesNotTouchEditor:true,copyPreservesBoundRulesAndNewerEditor:true,ruleAndAiSchedulesSeparated:true,tinyManualPriceAndAmountVisible:true,backtestFractionalHoldingVisible:true,noAiCalls:true,errors};fs.writeFileSync(process.env.REPORT_PATH||'reports/activity-workflows-check.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await Promise.all(contexts.map(c=>c.close()));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
