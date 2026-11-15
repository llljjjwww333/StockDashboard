const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:5176',key='marketdesk:crypto:portfolios:v2';
(async()=>{
 const {createPortfolio,executePortfolioOrder,bindStockStrategy,defaultMandate}=await import('../frontend/src/terminal/portfolio.ts');
 const {strategyDefaults}=await import('../frontend/src/terminal/backtest.ts');
 const {defaultCustomRules}=await import('../frontend/src/terminal/strategyRules.ts');
 const {withExecution}=await import('../frontend/src/terminal/strategyDefinition.ts');
 const instrument={ticker:'BTCUSDT',name:'Bitcoin',market:'CRYPTO'};
 const strategy=withExecution({...defaultMandate,id:'account-test-rule',name:'账户测试规则',goal:'Close > SMA20',instrument,maxSingle:20,maxGross:20,news:false},{...strategyDefaults,kind:'custom',rules:defaultCustomRules(),positionPct:20});
 const now=()=>new Date().toISOString(),quote=ticker=>({ticker,price:100,volume:1000,change_percent:0,source:'browser-fixture',as_of:now()});
 let first=executePortfolioOrder(createPortfolio('账户甲',100000,'CRYPTO'),'BTCUSDT','buy',1,quote('BTCUSDT'),'existing fill','Bitcoin');
 first=bindStockStrategy(first,{ticker:'BTCUSDT',name:'Bitcoin',label:strategy.name,mode:'rules',mandate:strategy,config:strategy.execution,profileId:'',allocationPct:20,enabled:false});
 const second=createPortfolio('账户乙',5000,'CRYPTO'),browser=await chromium.launch({channel:'msedge',headless:true}),contexts=[],errors=[];
 const button=(page,name)=>page.getByRole('button',{name,exact:true});
 const contents=p=>({capital:p.capital,cash:p.cash,fees:p.fees,realized:p.realized,positions:p.positions,orders:p.orders,config:p.config});
 async function setup({count=2,pending=false}={}){
  const accounts=[structuredClone(first),second,...Array.from({length:6},(_,i)=>createPortfolio('账户'+(i+3),1000,'CRYPTO'))].slice(0,count);
  if(pending){accounts[0].bindings[0].mode='ai';accounts[0].bindings[0].profileId='account-fixture';}
  const context=await browser.newContext({viewport:{width:1366,height:900},acceptDownloads:true});contexts.push(context);
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));let releaseJob;
  const profile={activeId:'account-fixture',profiles:[{id:'account-fixture',name:'测试接口',baseUrl:'https://fixture.invalid/v1',model:'account-test',protocol:'chat',apiKey:'fixture-only',rememberKey:true,updatedAt:1}]};
  await page.addInitScript(({accounts,profile,pending,key})=>{
   if(localStorage.getItem('account-management-seeded'))return;
   localStorage.setItem(key,JSON.stringify(accounts));localStorage.setItem('marketdesk:crypto:selected-portfolio:v2',accounts[0].id);
   localStorage.setItem('marketdesk:ai-profiles:v1',JSON.stringify(pending?profile:{profiles:[],activeId:''}));localStorage.setItem('account-management-seeded','yes');
  },{accounts,profile,pending,key});
  await context.routeWebSocket('**/ws/stock-updates',s=>s.onMessage(raw=>{if(JSON.parse(raw).type==='ping')s.send('{"type":"pong"}');}));
  await page.route('**/api/v1/**',async route=>{
   const request=route.request(),url=new URL(request.url()),path=url.pathname;
   if(path.endsWith('/ai/jobs'))return new Promise(resolve=>{releaseJob=async()=>{const body=request.postDataJSON(),time=now();await route.fulfill({status:202,json:{id:body.id,state:'completed',result:{id:crypto.randomUUID(),reviewed_at:time,provider:'browser-fixture',model:'account-test',decision:{regime:'trend',method:'fixture',summary:'delayed decision',reconsider_when:'next review',targets:[{ticker:'BTCUSDT',weight_pct:20,reason:'fixture'}],evidence_ids:['Q1']},evidence:[{id:'Q1',title:'BTC quote',source:'fixture',timestamp:time}]}}});resolve();};});
   const json=path.endsWith('/quotes')?{quotes:(url.searchParams.get('tickers')||'').split(',').filter(Boolean).map(quote)}:path.endsWith('/quote')?quote(path.split('/').at(-2)):{results:[],items:[],sources:[]};
   return route.fulfill({json});
  });
  await page.goto(base+'/?view=simulation',{timeout:90000});await button(page,'管理账户').waitFor();
  return {page,accounts,read:()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key),release:()=>releaseJob()};
 }
 const failStorage=page=>page.evaluate(key=>{window.originalAccountSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===key)throw new Error('Controlled account write failure');return window.originalAccountSet.call(this,k,v);};},key);
 const restoreStorage=page=>page.evaluate(()=>Storage.prototype.setItem=window.originalAccountSet);
 const deleteAccount=async page=>{await button(page,'管理账户').click();await button(page,'删除账户').click();await button(page,'确认删除账户').click();};
 try{
  const main=await setup(),page=main.page;
  await button(page,'管理账户').click();await page.getByLabel('修改账户名称',{exact:true}).fill('   ');await button(page,'保存账户名称').click();
  await page.getByText('请填写1至80字的账户名称',{exact:true}).waitFor();assert.equal((await main.read())[0].name,'账户甲');
  await page.getByLabel('修改账户名称',{exact:true}).fill('  主账户新名称  ');await button(page,'保存账户名称').click();
  await page.getByText('账户名称已保存',{exact:true}).waitFor();assert.equal((await main.read())[0].name,'主账户新名称');assert.deepEqual(contents((await main.read())[0]),contents(first));
  await page.reload();await button(page,'管理账户').waitFor();assert.equal(await page.locator('.portfolio-account-bar strong').innerText(),'主账户新名称');
  const download=page.waitForEvent('download');await button(page,'导出账户').click();const exported=JSON.parse(fs.readFileSync(await(await download).path(),'utf8'));
  assert.deepEqual(contents(exported),contents(first));assert(!JSON.stringify(exported).includes('fixture-only'));
  const upload=()=>page.locator('.portfolio-header-actions input[type=file]').setInputFiles({name:'account.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(exported))});
  await upload();await page.getByText('账户已存在',{exact:true}).waitFor();assert.equal((await main.read()).length,2);
  await button(page,'管理账户').click();await failStorage(page);await page.getByLabel('修改账户名称',{exact:true}).fill('失败名称');await button(page,'保存账户名称').click();
  await page.getByText('账户保存失败，运行已暂停。请导出账户。',{exact:true}).waitFor();assert.equal((await main.read())[0].name,'主账户新名称');
  await button(page,'删除账户').click();await button(page,'确认删除账户').click();assert.equal((await main.read()).length,2);assert.equal(await button(page,'撤销删除账户').count(),0);
  await restoreStorage(page);await button(page,'关闭弹窗').click();await button(page,'管理账户').click();await button(page,'删除账户').click();
  await page.screenshot({path:process.env.SCREENSHOT_PATH||'reports/account-management-dialog.png'});
  await button(page,'取消删除').click();assert.equal((await main.read()).length,2);await button(page,'删除账户').click();await button(page,'确认删除账户').click();
  assert.deepEqual((await main.read()).map(a=>a.id),[second.id]);assert.equal(await page.getByLabel('资金账户',{exact:true}).inputValue(),second.id);
  await failStorage(page);await button(page,'撤销删除账户').click();assert.equal((await main.read()).length,1);assert.equal(await button(page,'撤销删除账户').count(),1);
  await restoreStorage(page);await button(page,'撤销删除账户').click();assert.equal((await main.read()).length,2);assert.equal(await page.getByLabel('资金账户',{exact:true}).inputValue(),first.id);
  assert.deepEqual(contents((await main.read())[0]),contents(first));assert((await main.read())[0].bindings.every(b=>!b.enabled));
  await deleteAccount(page);await upload();await page.getByText('已导入',{exact:true}).waitFor();assert.equal((await main.read()).length,2);assert.equal(await button(page,'撤销删除账户').count(),0);
  const legacy=createPortfolio('旧美股',1000,'US');await page.locator('.portfolio-header-actions input[type=file]').setInputFiles({name:'old-account.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(legacy))});
  await page.getByText('请选择USDT现货模拟账户文件',{exact:true}).waitFor();assert.equal((await main.read()).length,2);
  await button(page,'新建账户').click();await page.getByLabel('账户名称',{exact:true}).fill('新增账户');await page.getByLabel('账户初始资金',{exact:true}).fill('12345');await button(page,'创建账户').click();
  assert.equal((await main.read()).length,3);assert.equal((await main.read()).at(-1).cash,12345);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const last=await setup({count:1});await deleteAccount(last.page);await last.page.getByLabel('账户名称',{exact:true}).waitFor();
  assert.deepEqual(await last.read(),[]);assert.equal(await button(last.page,'新建账户').count(),0);
  await button(last.page,'撤销删除账户').click();assert.equal((await last.read()).length,1);assert.deepEqual(contents((await last.read())[0]),contents(first));
  const pending=await setup({count:1,pending:true}),requested=pending.page.waitForRequest(r=>r.url().endsWith('/ai/jobs')&&r.method()==='POST');
  await button(pending.page,'启动全部').click();await requested;await deleteAccount(pending.page);await pending.release();await pending.page.waitForTimeout(250);
  assert.deepEqual(await pending.read(),[]);await button(pending.page,'撤销删除账户').click();const restored=(await pending.read())[0];
  assert.deepEqual(contents(restored),contents(first));assert.equal(restored.reviews.length,0);assert(restored.bindings.every(b=>!b.enabled));assert.equal(await button(pending.page,'暂停全部').count(),0);
  const full=await setup({count:8});assert(await button(full.page,'新建账户').isDisabled());
  await deleteAccount(full.page);await button(full.page,'新建账户').click();await full.page.getByLabel('账户名称',{exact:true}).fill('填满账户');await button(full.page,'创建账户').click();
  await button(full.page,'撤销删除账户').click();await full.page.getByText('账户已满，请先整理账户',{exact:true}).waitFor();assert.equal((await full.read()).length,8);
  assert.deepEqual(errors,[]);
  const report={url:base,fixtures:true,renamePersistsWithoutChangingBalances:true,blankNameRejected:true,exportAndReimportPreserveLedger:true,duplicateAndNonCryptoImportsRejected:true,failedRenameDeleteUndoPreserveData:true,deleteSelectionAndLastAccount:true,undoRestoresPausedAccount:true,pendingAiCannotTradeIntoRemovedAccount:true,creationAndCapacityWork:true,noHorizontalOverflow:true,errors};
  fs.writeFileSync(process.env.REPORT_PATH||'reports/account-management-check.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await Promise.all(contexts.map(c=>c.close()));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
