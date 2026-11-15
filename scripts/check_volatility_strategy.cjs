const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs'), assert = require('node:assert/strict');
const fixture = JSON.parse(fs.readFileSync('backend/tests/fixtures/volatility_target_design.json','utf8'));
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:5176';
(async () => {
 const browser = await chromium.launch({channel:'msedge',headless:true});
 const page = await browser.newPage({viewport:{width:1600,height:1000}}), errors=[];
 page.on('pageerror', e=>errors.push(e.message));
 try {
  await page.addInitScript(({publicCheck})=>localStorage.setItem('marketdesk:ai-profiles:v1',JSON.stringify({activeId:'conversion-fixture',profiles:[{id:'conversion-fixture',name:'转换测试接口',baseUrl:publicCheck?'https://fixture.invalid/v1':'http://127.0.0.1:8767/v1',model:'strategy-fixture',protocol:'chat',apiKey:'fixture-only',rememberKey:true,updatedAt:1}]})), {publicCheck:process.env.MOCK_MODEL==='1'});
  let submittedGoal = '';
  if(process.env.MOCK_MODEL==='1') await page.route('**/api/v1/ai/jobs', async route=>{
   const body=route.request().postDataJSON();submittedGoal=body.payload.goal;
   await route.fulfill({status:202,contentType:'application/json',body:JSON.stringify({id:body.id,state:'completed',result:{proposal:fixture.proposal}})});
  });
  await page.goto(base+'/?view=strategy',{timeout:90000});
  await page.getByRole('button',{name:'新建策略',exact:true}).click();
  await page.getByLabel('动态策略目标',{exact:true}).fill(fixture.goal);
  await page.getByRole('button',{name:'生成并填入参数',exact:true}).click();
  await page.getByText('已生成并填入全部参数，已保存',{exact:true}).waitFor({timeout:180000});
  if(process.env.MOCK_MODEL==='1') assert.equal(submittedGoal,fixture.goal);
  assert.equal(await page.getByLabel('买入规则 1 右值 周期',{exact:true}).inputValue(),'200');
  assert.equal(await page.getByLabel('买入规则 1 右值 系数',{exact:true}).inputValue(),'1.01');
  assert.equal(await page.getByLabel('买入规则 2 左值',{exact:true}).inputValue(),'momentum');
  assert.equal(await page.getByLabel('买入规则 2 左值 周期',{exact:true}).inputValue(),'90');
  assert.equal(await page.getByLabel('仓位计算方式',{exact:true}).inputValue(),'volatility_target');
  for(const [label,value] of [['波动率回看（日）','30'],['目标年化波动率（%）','10'],['资金比例上限（%）','45'],['再平衡阈值（百分点）','0'],['策略手续费（基点）','10'],['策略滑点（基点）','5'],['数据开始日期','2017-08-17'],['交易开始日期','2018-03-06']]) assert.equal(await page.getByLabel(label,{exact:true}).inputValue(),value,label);
  await page.getByText('查看波动率与仓位对照',{exact:true}).click();
  assert((await page.locator('.allocation-examples').innerText()).includes('33.33%'));
  assert.equal(await page.locator('.strategy-capability-issues').count(),0);
  await page.reload();await page.getByLabel('目标年化波动率（%）',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('买入规则 1 右值 周期',{exact:true}).inputValue(),'200');
  await page.getByRole('button',{name:'回测',exact:true}).click();
  await page.getByRole('button',{name:'运行回测',exact:true}).waitFor({timeout:90000});
  await page.waitForFunction(()=>!document.querySelector('button.strategy-run')?.disabled,null,{timeout:90000});
  assert.equal(await page.getByLabel('开始日期',{exact:true}).inputValue(),'2018-03-06');
  assert((await page.getByLabel('历史范围',{exact:true}).innerText()).includes('指定数据区间'));
  assert.equal(await page.getByLabel('单边费率（基点）',{exact:true}).inputValue(),'10');
  await page.getByRole('button',{name:'运行回测',exact:true}).click();
  await page.getByRole('button',{name:'保存结果',exact:true}).waitFor({timeout:30000});
  const range=await page.getByLabel('回测数据范围',{exact:true}).innerText();
  assert(range.includes('2017-08-17'));assert(range.includes('2026-11-14'));
  assert(!range.includes('2017-08-17 — 2018-08'));
  assert.deepEqual(errors,[]);
  const report={url:base,providerFixture:true,aiOutputSchemaTested:process.env.MOCK_MODEL!=='1',exactIndicators:true,dynamicWeights:true,costsAndDatesFilled:true,reloadPreserved:true,realBinanceHistory:true,range,backtestCompleted:true,errors};
  fs.writeFileSync(process.env.REPORT_PATH||'reports/volatility-strategy-check.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
