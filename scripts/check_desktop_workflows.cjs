const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:5176';
(async()=>{
 const {defaultMandate,createPortfolio,executePortfolioOrder}=await import('../frontend/src/terminal/portfolio.ts');
 const {editStrategyExecution,withExecution}=await import('../frontend/src/terminal/strategyDefinition.ts');
 const {strategyDefaults}=await import('../frontend/src/terminal/backtest.ts');
 const {defaultCustomRules}=await import('../frontend/src/terminal/strategyRules.ts');
 const original=JSON.parse(fs.readFileSync('reports/BTCUSDT-low-volatility.strategy.json','utf8'));
 const vol=editStrategyExecution(original,original.instrument,{...original.execution,allocation:{...original.execution.allocation,minPositionPct:5}});
 const rules=withExecution({...defaultMandate,id:'rules-workflow',name:'规则执行核对',goal:'Close > SMA20',instrument:vol.instrument,maxSingle:20,maxGross:20,news:false},
  {...strategyDefaults,kind:'custom',rules:defaultCustomRules(),positionPct:20,sessionsPerYear:365});
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const page=await context.newPage(),errors=[];let aiRequests=0;
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/ai/'))aiRequests++;});
 await page.addInitScript(({vol,rules})=>{
  if(!localStorage.getItem('desktop-workflow-seeded')){
   localStorage.setItem('marketdesk:crypto:portfolio-strategies:v1',JSON.stringify([vol,rules]));
   localStorage.setItem('marketdesk:crypto:strategy-editor-drafts:v1',JSON.stringify([vol,rules]));
   localStorage.setItem('marketdesk:crypto:selected-strategy:v1',vol.id);
   localStorage.setItem('marketdesk:ai-profiles:v1',JSON.stringify({profiles:[],activeId:''}));
   localStorage.setItem('desktop-workflow-seeded','yes');
  }
 },{vol,rules});
 try{
  await page.goto(base+'/?view=strategy',{timeout:90000});
  await page.getByLabel('目标年化波动率（%）',{exact:true}).waitFor();
  await page.evaluate(()=>scrollTo(0,900));
  await page.waitForTimeout(300);
  const toolbar=await page.locator('.workbench-editor-toolbar').boundingBox();
  assert(toolbar.y>=70&&toolbar.y<80,'Editor actions must remain below the fixed top bar');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:process.env.SCREENSHOT_PATH||'reports/desktop-workflows-editor.png'});
  await page.getByLabel('资金比例上限（%）',{exact:true}).fill('');
  assert.equal(await page.getByLabel('资金比例上限（%）',{exact:true}).inputValue(),'');
  assert.equal(await page.getByRole('button',{name:'部署到模拟',exact:true}).isDisabled(),true);
  await page.getByLabel('资金比例上限（%）',{exact:true}).fill('30');
  assert((await page.locator('.allocation-formula').innerText()).includes('min(30%'));
  const caps=await page.evaluate(id=>JSON.parse(localStorage.getItem('marketdesk:crypto:strategy-editor-drafts:v1')).find(m=>m.id===id),vol.id);
  assert.equal(caps.maxSingle,30);assert.equal(caps.maxGross,30);assert.equal(caps.execution.positionPct,30);
  await page.getByLabel('资金比例上限（%）',{exact:true}).fill('45');
  await page.getByLabel('动态策略目标',{exact:true}).fill('改成SMA150，等待重新生成');
  assert.equal(await page.locator('.design-execution').isVisible(),false);
  assert.equal(await page.getByRole('button',{name:'部署到模拟',exact:true}).isDisabled(),true);
  await page.getByText(/上一次的策略参数/).click();
  assert((await page.locator('.strategy-previous-parameters').innerText()).includes('max(5%'));
  await page.getByText('原始输入目标',{exact:true}).click();
  await page.getByRole('button',{name:'恢复原始输入到编辑框',exact:true}).click();
  assert.equal(await page.getByLabel('动态策略目标',{exact:true}).inputValue(),vol.sourceGoal);
  await page.locator('.workbench-strategy-list button').filter({hasText:'规则执行核对'}).click();
  await page.getByRole('button',{name:'部署到模拟',exact:true}).click();
  await page.getByLabel('账户名称',{exact:true}).fill('规则实用性检查');
  await page.getByRole('button',{name:'创建并部署',exact:true}).click();
  await page.getByRole('button',{name:'启动全部',exact:true}).click();
  await page.waitForFunction(()=>{
   const accounts=JSON.parse(localStorage.getItem('marketdesk:crypto:portfolios:v2')||'[]');
   return accounts[0]?.reviews?.some(r=>r.provider==='规则引擎');
  },null,{timeout:60000});
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('marketdesk:crypto:portfolios:v2'))[0]);
  assert.equal(stored.bindings[0].mode,'rules');assert.equal(stored.bindings[0].allocationPct,20);assert.equal(aiRequests,0);
  await page.getByRole('button',{name:'暂停全部',exact:true}).click();
  await page.getByRole('button',{name:'编辑',exact:true}).first().click();
  await page.getByLabel('绑定策略',{exact:true}).selectOption('ai:'+vol.id);
  assert.equal(await page.getByLabel('绑定资金比例',{exact:true}).inputValue(),'45');
  assert.equal(await page.getByLabel('绑定接口',{exact:true}).count(),0);
  await page.getByRole('button',{name:'保存',exact:true}).click();
  assert.equal(aiRequests,0);
  const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('marketdesk:crypto:portfolios:v2'))[0]);
  assert.equal(after.bindings[0].mode,'rules');assert.equal(after.bindings[0].allocationPct,45);assert.equal(after.bindings[0].config.allocation.targetVolPct,10);
  const context2=await browser.newContext({viewport:{width:1600,height:1000}}),backtest=await context2.newPage();
  backtest.on('pageerror',e=>errors.push(e.message));
  await backtest.addInitScript(vol=>{
   localStorage.setItem('marketdesk:crypto:portfolio-strategies:v1',JSON.stringify([vol]));
   localStorage.setItem('marketdesk:crypto:strategy-editor-drafts:v1',JSON.stringify([vol]));
   localStorage.setItem('marketdesk:crypto:selected-strategy:v1',vol.id);
  },vol);
  await backtest.goto(base+'/?view=strategy',{timeout:90000});
  await backtest.getByRole('button',{name:'回测',exact:true}).click();
  await backtest.waitForFunction(()=>!document.querySelector('button.strategy-run')?.disabled,null,{timeout:90000});
  await backtest.getByRole('button',{name:'运行回测',exact:true}).click();
  await backtest.getByLabel('每页记录数',{exact:true}).waitFor({timeout:30000});
  assert.equal(await backtest.locator('.strategy-ledger tbody tr').count(),50);
  const first=await backtest.locator('.strategy-ledger tbody tr').first().innerText();
  await backtest.getByRole('button',{name:'下一页交易',exact:true}).click();
  assert.notEqual(await backtest.locator('.strategy-ledger tbody tr').first().innerText(),first);
  await backtest.getByLabel('每页记录数',{exact:true}).selectOption('25');
  assert.equal(await backtest.locator('.strategy-ledger tbody tr').count(),25);
  await backtest.locator('.strategy-tabs button').filter({hasText:'成交明细'}).click();
  assert.equal(await backtest.locator('.strategy-ledger tbody tr').count(),50);
  await backtest.getByText('参数快照',{exact:true}).click();
  const snapshot=await backtest.locator('.strategy-snapshot-content').innerText();
  assert(snapshot.includes('max(5%'));assert(snapshot.includes('0.1%'));assert(snapshot.includes('2017-08-17'));
  const now=new Date(),tiny=executePortfolioOrder(createPortfolio('精度核对',10000,'CRYPTO'),'SHIBUSDT','buy',.001,
   {ticker:'SHIBUSDT',price:.00001867,volume:1000,change_percent:0,source:'fixture',as_of:now.toISOString()},'fixture','SHIB',strategyDefaults,now);
  const context3=await browser.newContext({viewport:{width:1440,height:1000}}),precision=await context3.newPage();
  precision.on('pageerror',e=>errors.push(e.message));
  await precision.addInitScript(tiny=>{
   localStorage.setItem('marketdesk:crypto:portfolios:v2',JSON.stringify([tiny]));
   localStorage.setItem('marketdesk:crypto:selected-portfolio:v2',tiny.id);
  },tiny);
  await precision.goto(base+'/?view=simulation',{timeout:90000});
  const holding=precision.locator('.portfolio-table tbody tr').first();
  await holding.waitFor();
  assert((await holding.locator('td').nth(1).innerText()).includes('0.001'));
  const mark=Number((await holding.locator('td').nth(2).innerText()).split('\n')[0].replaceAll(',',''));
  assert(mark>0&&mark<.01,'Small coin mark must not round to zero');
  await precision.locator('.portfolio-ledger nav button').filter({hasText:'委托与成交'}).click();
  const order=precision.locator('.portfolio-table tbody tr').first();
  assert.equal(await order.locator('td').nth(3).innerText(),'0.001');
  assert(Number(await order.locator('td').nth(4).innerText())>0);
  assert.equal(await order.locator('td').nth(5).innerText(),'<0.00000001');
  await context3.close();
  assert.deepEqual(errors,[]);
  const report={url:base,stickyActions:true,staleParametersSeparated:true,originalInputRestored:true,customRulesRunWithoutApiKey:true,
   noAiCallsForRules:aiRequests===0,allocationSuggestedFromStrategy:true,volatilityBindingUsesRules:true,
   largeLedgersPaginated:true,snapshotIncludesFloorAndCosts:true,smallCoinAndFeePrecision:true,positionCapEditsStaySynchronized:true,errors};
  fs.writeFileSync(process.env.REPORT_PATH||'reports/desktop-workflows-check.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  await context2.close();
 }finally{await context.close();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
