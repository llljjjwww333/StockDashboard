const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:5176';
(async()=>{
 const {createPortfolio,defaultMandate,bindStockStrategy,portfolioEquity,executePortfolioOrder}=await import('../frontend/src/terminal/portfolio.ts');
 const {withExecution}=await import('../frontend/src/terminal/strategyDefinition.ts');
 const {strategyDefaults}=await import('../frontend/src/terminal/backtest.ts');
 const {defaultCustomRules}=await import('../frontend/src/terminal/strategyRules.ts');
 const instrument={ticker:'BTCUSDT',name:'Bitcoin',market:'CRYPTO'};
 const strategy=withExecution({...defaultMandate,id:'binding-cap-fixture',name:'仓位上限核对',goal:'Close > SMA20',instrument,maxSingle:20,maxGross:20,news:false},
  {...strategyDefaults,kind:'custom',rules:defaultCustomRules(),positionPct:20,sessionsPerYear:365,feeBps:100,slippageBps:100});
 const original=JSON.parse(fs.readFileSync('reports/BTCUSDT-low-volatility.strategy.json','utf8'));
 const plan={...JSON.parse(fs.readFileSync('backend/tests/fixtures/staged_plan.json','utf8')),trimMaEnabled:false,trimRsiEnabled:false,includeNews:false};
 const stagedStrategy=withExecution({...strategy,id:'staged-cap-fixture',maxSingle:25,maxGross:25},{...strategy.execution,plan,rules:null,positionPct:25});
 const browser=await chromium.launch({channel:'msedge',headless:true}),errors=[];
 const bars=Array.from({length:300},(_,i)=>{
  const date=new Date();date.setUTCHours(0,0,0,0);date.setUTCDate(date.getUTCDate()-300+i);
  const close=100+i*.1;return {timestamp:date.toISOString(),open:close,high:close+1,low:close-1,close,volume:1000};
 });
 const profile={activeId:'cap-fixture',profiles:[{id:'cap-fixture',name:'规则边界测试',baseUrl:'https://fixture.invalid/v1',model:'cap-test',protocol:'chat',apiKey:'fixture-only',rememberKey:true,updatedAt:1}]};
 const contexts=[];
 async function setup({mode='rules',volatility=false,api=false,modelWeight=15,prior=false,staged=false}={}){
  const saved=staged?stagedStrategy:volatility?original:strategy;
  const binding={ticker:'BTCUSDT',name:'Bitcoin',label:saved.name,mode,mandate:mode==='ai'&&!volatility?{...saved,maxGross:15}:saved,config:saved.execution,profileId:api?'cap-fixture':'',allocationPct:staged?10:60,enabled:false};
  let account=bindStockStrategy(createPortfolio('绑定上限检查',100000,'CRYPTO'),binding);
  if(staged)account=executePortfolioOrder(account,'BTCUSDT','buy',120,{ticker:'BTCUSDT',price:100,volume:1000,change_percent:0,source:'fixture',as_of:new Date().toISOString()},'existing staged holding','BTC',binding.config);
  if(prior){
   const stamp=new Date().toISOString(),quote={ticker:'BTCUSDT',price:100,volume:1000,change_percent:0,source:'fixture',as_of:stamp};
   account=executePortfolioOrder(account,'BTCUSDT','buy',600,quote,'old oversized entry','BTC',binding.config);
   account.reviews=[{ticker:'BTCUSDT',strategy:binding.label,ruleKey:JSON.stringify([binding.config,binding.allocationPct,binding.label]),id:crypto.randomUUID(),reviewed_at:stamp,provider:'规则引擎',model:'custom',execution:'已成交',decision:{regime:'trend',method:'old rule',summary:'旧版本仓位',reconsider_when:'next daily signal',targets:[{ticker:'BTCUSDT',weight_pct:60,reason:'old binding budget'}],evidence_ids:['H1']},evidence:[{id:'H1',title:'history',source:'fixture',timestamp:stamp}]}];
  }
  const context=await browser.newContext({viewport:{width:1440,height:1000}});contexts.push(context);
  const page=await context.newPage(),ai=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(({account,strategy,original,profile,api})=>{
   if(localStorage.getItem('cap-check-seeded'))return;
   localStorage.setItem('marketdesk:crypto:portfolios:v2',JSON.stringify([account]));
   localStorage.setItem('marketdesk:crypto:selected-portfolio:v2',account.id);
   localStorage.setItem('marketdesk:crypto:portfolio-strategies:v1',JSON.stringify([strategy,original]));
   localStorage.setItem('marketdesk:crypto:strategy-editor-drafts:v1',JSON.stringify([strategy,original]));
   localStorage.setItem('marketdesk:crypto:selected-strategy:v1',strategy.id);
   localStorage.setItem('marketdesk:ai-profiles:v1',JSON.stringify(api?profile:{profiles:[],activeId:''}));
   localStorage.setItem('cap-check-seeded','yes');
  },{account,strategy,original,profile,api});
  await page.route('**/api/v1/market/quotes?*',route=>{
   const tickers=new URL(route.request().url()).searchParams.get('tickers').split(',');
   return route.fulfill({json:{quotes:tickers.map(ticker=>({ticker,price:100,volume:1000,change_percent:0,source:'browser-fixture',as_of:new Date().toISOString()}))}});
  });
  await page.route('**/api/v1/stocks/*/history?*',route=>route.fulfill({json:{ticker:'BTCUSDT',interval:'1d',source:'browser-fixture',price_type:'historical',fetched_at:new Date().toISOString(),data:bars}}));
  await page.route('**/api/v1/ai/jobs',route=>{
   const body=route.request().postDataJSON();ai.push(body.payload);
   const stamp=new Date().toISOString();
   return route.fulfill({status:202,json:{id:body.id,state:'completed',result:{id:crypto.randomUUID(),reviewed_at:stamp,provider:'browser-fixture',model:'cap-test',decision:{regime:'trend',method:'test',summary:'仓位边界测试',reconsider_when:'next review',targets:[{ticker:'BTCUSDT',weight_pct:modelWeight,reason:'fixture'}],evidence_ids:['Q1']},evidence:[{id:'Q1',title:'BTCUSDT quote',source:'fixture',timestamp:stamp}]}}});
  });
  const state=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('marketdesk:crypto:portfolios:v2')));
  await page.goto(base+'/?view=simulation',{timeout:90000});
  await page.getByRole('button',{name:'启动全部',exact:true}).waitFor();
  return {page,ai,account,state};
 }
 try{
  const rule=await setup();await rule.page.getByRole('button',{name:'启动全部',exact:true}).click();
  await rule.page.waitForFunction(()=>JSON.parse(localStorage.getItem('marketdesk:crypto:portfolios:v2'))[0].reviews.length>0,null,{timeout:30000});
  const result=(await rule.state())[0];assert.equal(result.reviews[0].decision.targets[0].weight_pct,20);
  assert.equal(result.reviews[0].execution,'已成交');
  assert(result.positions[0].shares*100/portfolioEquity(result,{BTCUSDT:{price:100}})*100<=20.000001);assert.equal(rule.ai.length,0);
  await rule.page.getByRole('button',{name:'暂停全部',exact:true}).click();
  await rule.page.locator('.portfolio-ledger nav button').filter({hasText:'币种策略'}).click();
  assert((await rule.page.locator('.portfolio-table tbody').innerText()).includes('执行上限 20%'));
  await rule.page.getByRole('button',{name:'编辑',exact:true}).click();
  await rule.page.screenshot({path:process.env.SCREENSHOT_PATH||'reports/binding-limits-dialog.png'});
  assert.equal(await rule.page.getByLabel('绑定资金比例',{exact:true}).getAttribute('max'),'20');
  await rule.page.getByRole('button',{name:'保存',exact:true}).click();
  await rule.page.getByText('当前策略最多可分配 20%',{exact:true}).waitFor();
  await rule.page.getByLabel('绑定资金比例',{exact:true}).fill('20');
  await rule.page.getByLabel('绑定执行方式',{exact:true}).selectOption('ai');
  assert.equal(await rule.page.getByLabel('绑定接口',{exact:true}).count(),1);
  await rule.page.getByRole('button',{name:'保存',exact:true}).click();await rule.page.getByText('请选择 AI 接口',{exact:true}).waitFor();
  await rule.page.getByLabel('绑定执行方式',{exact:true}).selectOption('rules');
  assert.equal(await rule.page.getByLabel('绑定接口',{exact:true}).count(),0);
  await rule.page.getByRole('button',{name:'保存',exact:true}).click();
  assert.equal((await rule.state())[0].bindings[0].allocationPct,20);
  await rule.page.goto(base+'/?view=strategy',{timeout:90000});
  await rule.page.getByRole('button',{name:'部署到模拟',exact:true}).click();
  await rule.page.getByLabel('部署账户',{exact:true}).selectOption('new');
  assert.equal(await rule.page.getByLabel('部署资金比例',{exact:true}).getAttribute('max'),'20');
  await rule.page.getByLabel('部署资金比例',{exact:true}).fill('30');
  await rule.page.getByLabel('账户名称',{exact:true}).fill('部署额度检查');
  await rule.page.getByRole('button',{name:'创建并部署',exact:true}).click();
  await rule.page.getByText('当前策略最多可分配 20%',{exact:true}).waitFor();assert.equal((await rule.state()).length,1);
  await rule.page.getByLabel('部署资金比例',{exact:true}).fill('20');
  await rule.page.getByRole('button',{name:'创建并部署',exact:true}).click();
  await rule.page.getByRole('button',{name:'启动全部',exact:true}).waitFor();assert.equal((await rule.state()).length,2);
  const prior=await setup({prior:true});await prior.page.getByRole('button',{name:'启动全部',exact:true}).click();
  await prior.page.waitForFunction(()=>JSON.parse(localStorage.getItem('marketdesk:crypto:portfolios:v2'))[0].reviews.length>1,null,{timeout:30000});
  const corrected=(await prior.state())[0];assert.equal(corrected.reviews.at(-1).decision.targets[0].weight_pct,20);
  assert.equal(corrected.orders.at(-1).side,'sell');assert(corrected.positions[0].shares*100/portfolioEquity(corrected,{BTCUSDT:{price:100}})*100<20.000001);
  const staged=await setup({staged:true});await staged.page.getByRole('button',{name:'启动全部',exact:true}).click();
  await staged.page.waitForFunction(()=>JSON.parse(localStorage.getItem('marketdesk:crypto:portfolios:v2'))[0].reviews.length>0,null,{timeout:30000});
  const stagedAccount=(await staged.state())[0];assert.equal(stagedAccount.reviews[0].provider,'分批规则引擎');assert.equal(stagedAccount.reviews[0].decision.targets[0].weight_pct,10);
  assert.equal(stagedAccount.orders.at(-1).side,'sell');assert(stagedAccount.positions[0].shares*100/portfolioEquity(stagedAccount,{BTCUSDT:{price:100}})*100<10.000001);
  assert.equal(staged.ai.length,0);
  const ai=await setup({mode:'ai',api:true});await ai.page.getByRole('button',{name:'启动全部',exact:true}).click();
  await ai.page.waitForFunction(()=>JSON.parse(localStorage.getItem('marketdesk:crypto:portfolios:v2'))[0].reviews.length>0,null,{timeout:30000});
  assert.equal(ai.ai.length,1);assert.equal(ai.ai[0].max_single_pct,15);assert.equal(ai.ai[0].max_gross_pct,15);
  assert.equal((await ai.state())[0].reviews[0].execution,'已成交');
  await ai.page.getByRole('button',{name:'暂停全部',exact:true}).click();
  await ai.page.locator('.portfolio-ledger nav button').filter({hasText:'币种策略'}).click();
  await ai.page.getByRole('button',{name:'编辑',exact:true}).click();
  assert.equal(await ai.page.getByLabel('绑定执行方式',{exact:true}).inputValue(),'ai');
  await ai.page.getByLabel('绑定资金比例',{exact:true}).fill('15');await ai.page.getByRole('button',{name:'保存',exact:true}).click();
  await ai.page.reload();assert.equal((await ai.state())[0].bindings[0].mode,'ai');
  const invalid=await setup({mode:'ai',api:true,modelWeight:16});await invalid.page.getByRole('button',{name:'启动全部',exact:true}).click();
  await invalid.page.waitForFunction(()=>JSON.parse(localStorage.getItem('marketdesk:crypto:portfolios:v2'))[0].reviews.length>0,null,{timeout:30000});
  const rejected=(await invalid.state())[0];assert.equal(rejected.orders.length,0);assert.equal(rejected.reviews[0].execution,'目标仓位超过策略执行上限');
  const vol=await setup({mode:'ai',volatility:true});await vol.page.getByRole('button',{name:'启动全部',exact:true}).click();
  await vol.page.getByRole('button',{name:'暂停全部',exact:true}).waitFor();
  await vol.page.getByRole('button',{name:'暂停全部',exact:true}).click();
  await vol.page.locator('.portfolio-ledger nav button').filter({hasText:'币种策略'}).click();
  await vol.page.getByRole('button',{name:'编辑',exact:true}).click();
  assert.equal(await vol.page.getByLabel('绑定接口',{exact:true}).count(),0);assert.equal(await vol.page.getByLabel('绑定执行方式',{exact:true}).count(),0);
  await vol.page.getByLabel('绑定资金比例',{exact:true}).fill('45');await vol.page.getByRole('button',{name:'保存',exact:true}).click();
  assert.equal((await vol.state())[0].bindings[0].mode,'rules');assert.equal(vol.ai.length,0);
  assert.deepEqual(errors,[]);
  const report={url:base,marketAndModelFixtures:true,stagedBudgetReduction:true,legacyBudgetPreserved:true,previousDailyReviewRechecked:true,ruleTargetCappedAt20:true,postCostWeightWithinCap:true,explicitModeSelection:true,missingAiProfileBlocksOnlyAi:true,deploymentCapValidated:true,aiRequestLimit15:true,oversizedAiTargetRejected:true,aiModePreservedAfterReload:true,legacyVolatilityRunsAsRules:true,errors};
  fs.writeFileSync(process.env.REPORT_PATH||'reports/binding-limits-check.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await Promise.all(contexts.map(c=>c.close()));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
