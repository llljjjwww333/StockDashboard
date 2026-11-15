const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const base=process.env.PREVIEW_URL||'https://stock-dashboard-web-rf7v.onrender.com';
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});let context=await browser.newContext({viewport:{width:1440,height:900}});let calls=0;const errors=[];
 try{
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/ai/'))calls++;});
  await page.goto(base+'/?view=markets',{timeout:90000});await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.getByRole('button',{name:'添加接口',exact:true}).click();
  await page.getByLabel('接口名称',{exact:true}).fill('配置持久化检查');await page.getByLabel('接口地址',{exact:true}).fill('https://fixture.invalid/v1');await page.getByLabel('模型',{exact:true}).fill('retention-fixture');
  await page.getByLabel('API Key',{exact:true}).fill('test-only-not-a-real-key');await page.getByLabel('在此设备记住密钥',{exact:true}).check();await page.getByRole('button',{name:'保存并使用',exact:true}).click();
  await page.getByRole('button',{name:'配置持久化检查',exact:true}).waitFor();
  await page.reload();await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'配置持久化检查',exact:true}).click();
  assert.equal(await page.getByLabel('API Key',{exact:true}).inputValue(),'test-only-not-a-real-key');assert(await page.getByLabel('在此设备记住密钥',{exact:true}).isChecked());
  const asset=await page.locator('script[type=module]').getAttribute('src'),state=await context.storageState();await context.close();
  context=await browser.newContext({storageState:state,viewport:{width:1440,height:900}});const fresh=await context.newPage();fresh.on('pageerror',e=>errors.push(e.message));fresh.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/ai/'))calls++;});
  await fresh.goto(base+'/?view=markets',{timeout:90000});await fresh.getByRole('button',{name:'设置',exact:true}).click();await fresh.getByRole('button',{name:'配置持久化检查',exact:true}).click();
  assert.equal(await fresh.getByLabel('API Key',{exact:true}).inputValue(),'test-only-not-a-real-key');assert.equal(await fresh.getByLabel('接口地址',{exact:true}).inputValue(),'https://fixture.invalid/v1');
  await fresh.getByLabel('接口名称',{exact:true}).fill('配置改名检查');await fresh.getByRole('button',{name:'保存并使用',exact:true}).click();await fresh.getByRole('button',{name:'配置改名检查',exact:true}).click();
  assert.equal(await fresh.getByLabel('API Key',{exact:true}).inputValue(),'test-only-not-a-real-key');
  await fresh.getByRole('button',{name:'删除',exact:true}).click();assert.equal(await fresh.locator('.provider-list [data-profile-id]').count(),0);
  assert.equal(calls,0);assert.deepEqual(errors,[]);
  const report={url:base,asset,fixtureOnly:true,savedThroughUi:true,rememberedKeySurvivesReload:true,newSessionPreservesConfiguration:true,renamePreservesKey:true,deleteProfileWorks:true,aiRequests:calls,errors};
  fs.writeFileSync(process.env.REPORT_PATH||'reports/render-profile-current-check.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await context.close();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
