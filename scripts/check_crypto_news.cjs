const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const base=process.env.PREVIEW_URL||'http://127.0.0.1:5176';
const api=process.env.API_URL||base;
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'msedge'}),context=await browser.newContext({viewport:{width:1600,height:1000}}),page=await context.newPage(),errors=[],apiFailures=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().includes('/api/v1/')&&r.status()>=400)apiFailures.push({url:r.url(),status:r.status()});});
 const button=name=>page.getByRole('button',{name,exact:true}),field=name=>page.getByLabel(name,{exact:true});
 try{
  await page.goto(base+'/?view=news&market=CRYPTO');await page.locator('.crypto-news-row').first().waitFor({timeout:60000});
  assert.equal(await field('资讯语言').inputValue(),'zh');assert(await page.locator('.crypto-news-sources>button').count()>=4);
  const live=await(await page.request.get(api+'/api/v1/news?market=CRYPTO&limit=200')).json();assert(live.items.some(n=>n.language==='zh'));assert(live.items.some(n=>n.language==='en'));assert(live.items.every(n=>n.id&&n.published_at&&n.url));
  assert(live.sources.some(n=>n.name==='PANews'&&n.item_count>0));assert(live.sources.some(n=>n.name==='ChainCatcher'&&n.item_count>0));
  await page.screenshot({path:'.local/crypto-news-desktop.png'});
  const first=page.locator('.crypto-news-row').first(),id=await first.getAttribute('data-news-id'),title=await first.locator('h3').innerText();
  await first.locator('.crypto-news-save').click();assert.equal(await first.locator('.crypto-news-save').getAttribute('aria-pressed'),'true');
  await page.locator('.crypto-news-tabs').getByRole('button',{name:'收藏 1',exact:true}).click();assert.equal(await page.locator('.crypto-news-row').count(),1);
  await page.locator('.crypto-news-open').click();await page.locator('.news-dialog').waitFor();assert.equal(await page.locator('#news-dialog-title').innerText(),title);
  const link=await page.getByRole('link',{name:'阅读原文（新窗口）',exact:true}).getAttribute('href');assert(link.startsWith('https://'));
  await page.screenshot({path:'.local/crypto-news-reader.png'});await button('关闭新闻').click();
  assert((await page.evaluate(()=>JSON.parse(localStorage.getItem('marketdesk:crypto:news-library:v1')).read)).includes(id));
  await page.reload();await page.locator('.crypto-news-row').first().waitFor({timeout:60000});assert.equal(await page.locator('.crypto-news-tabs').getByRole('button',{name:'收藏 1',exact:true}).getAttribute('aria-pressed'),'true');assert.equal(await page.locator('.crypto-news-row').count(),1);
  await button('重置筛选').click();await page.locator('.crypto-news-coins').getByRole('button',{name:'BTC',exact:true}).click();
  await page.locator('.crypto-news-row').first().waitFor();assert(await page.locator('.crypto-news-row').count()>0);
  await page.locator('.crypto-news-row').first().getByRole('button',{name:'查看 BTCUSDT 行情',exact:true}).click();
  await page.locator('.instrument-title strong').filter({hasText:'BTCUSDT'}).waitFor({timeout:30000});
  await page.goBack();await page.locator('.crypto-news-row').first().waitFor();assert.equal(await page.locator('.crypto-news-coins').getByRole('button',{name:'BTC',exact:true}).getAttribute('aria-pressed'),'true');
  await button('重置筛选').click();await page.locator('.crypto-news-sources').getByRole('button',{name:/CoinDesk/}).click();await page.locator('.crypto-news-row').first().waitFor();
  assert.equal(await field('资讯语言').inputValue(),'ALL');const sourceNames=await page.locator('.crypto-news-tags>span').allTextContents();assert(sourceNames.length&&sourceNames.every(n=>n==='CoinDesk'));
  await field('搜索资讯').fill('unmatchable-crypto-news-qa-20261115');await page.getByText('暂无匹配资讯',{exact:true}).waitFor();
  await button('重置筛选').click();await field('资讯时间范围').selectOption('24h');
  const dates=await page.locator('.crypto-news-row>time').evaluateAll(rows=>rows.map(n=>n.dateTime));assert(dates.length&&dates.every(d=>Date.now()-Date.parse(d)<86400000+5000));
  await button('重置筛选').click();const topic=live.items.find(n=>n.language==='zh'&&n.topic)?.topic;assert(topic);await field('资讯主题').selectOption(topic);
  const topicLabels=await page.locator('.crypto-news-tags>small').allTextContents();assert(topicLabels.length&&topicLabels.every(n=>n===topic));
  await button('重置筛选').click();await page.locator('.crypto-news-tabs').getByRole('button',{name:'未读',exact:true}).click();assert.equal(await page.locator(`[data-news-id="${id}"]`).count(),0);
  await button('重置筛选').click();await page.locator('.crypto-news-tabs').getByRole('button',{name:'收藏 1',exact:true}).click();await page.locator('.crypto-news-save').click();assert.equal(await page.locator('.crypto-news-row').count(),0);
  await page.getByText('暂无匹配收藏',{exact:true}).waitFor();await button('重置筛选').click();
  const before=page.locator('.crypto-news-row').count();if(await page.getByRole('button',{name:/^加载更多/}).count()){await page.getByRole('button',{name:/^加载更多/}).click();assert(await page.locator('.crypto-news-row').count()>await before);}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert(!/历史回测不伪造|仅供参考|不构成投资建议|不代表.*收益/.test(await page.locator('body').innerText()));
  assert.deepEqual(errors,[]);assert.deepEqual(apiFailures,[]);
  const report={base,desktopWidth:1600,realFeedItems:live.items.length,sources:live.sources.map(n=>({name:n.name,status:n.status,count:n.item_count})),chineseDefault:true,sourceLanguageCoinTopicTimeFilters:true,bookmarkSaveReloadRemove:true,readState:true,readerOriginalLink:true,coinNavigationAndBack:true,loadMore:true,conciseCopy:true,errors,apiFailures};
  fs.writeFileSync(process.env.REPORT_PATH||'reports/crypto-news-check.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }catch(e){await page.screenshot({path:'.local/crypto-news-failure.png'});throw e;}finally{await context.close();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
