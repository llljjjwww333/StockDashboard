const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const report = [];
  try {
    for (const width of [1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(() => {
        if (!localStorage.getItem('crypto-dashboard-watchlist:v1')) localStorage.setItem('crypto-dashboard-watchlist:v1', JSON.stringify({ version: 0, state: {
          watchlist: [...['BTCUSDT', 'ETHUSDT', 'SOLUSDT'].map(ticker => ({ ticker, name: ticker, market: 'CRYPTO' })),{ticker:'AAPL',name:'Legacy Apple',market:'US'}], selectedTicker: 'BTCUSDT',
        } }));
      });
      await page.routeWebSocket('**/ws/stock-updates', socket => socket.onMessage(raw => {
        if (JSON.parse(raw).type === 'ping') socket.send('{"type":"pong"}');
      }));
      await page.route('**/api/v1/**', async route => {
        const url = new URL(route.request().url());
        let json = { results: [] };
        if (url.pathname.endsWith('/quote')) json = { ticker: url.pathname.split('/')[4], price: 100, volume: 1000, change_percent: 1 };
        else if (url.pathname.endsWith('/quotes')) json = { quotes: [], unavailable: [] };
        else if (url.pathname.endsWith('/history')) json = { ticker: url.pathname.split('/')[4], data: [], interval: '1m' };
        else if (url.pathname.endsWith('/news')) json = { market: 'ALL', items: [], keywords: [] };
        else if (url.pathname.endsWith('/hotspots')) json = { market: 'CRYPTO', indices: [], sectors: [], leaders: [], laggards: [], active: [], breadth: { total: 0, advancers: 0, decliners: 0, flat: 0 }, summary: {} };
        await route.fulfill({ json });
      });
      await page.goto(process.env.PREVIEW_URL || 'http://127.0.0.1:5176');
      const tickers = () => page.locator('.watch-name > strong').allTextContents();
      const title = () => page.locator('.instrument-title strong').innerText();
      const open = ticker => page.locator('.watch-select').filter({ hasText: ticker }).click();
      const remove = ticker => page.getByRole('button', { name: `移除 ${ticker}`, exact: true }).click();
      const undo = () => page.getByRole('button', { name: '撤销移除', exact: true }).click();
      await open('ETHUSDT');
      await remove('ETHUSDT');
      assert.equal(await title(), 'ETHUSDT');
      assert.deepEqual(await tickers(), ['BTCUSDT', 'SOLUSDT']);
      await open('SOLUSDT');
      await remove('SOLUSDT');
      await undo();
      assert.equal(await title(), 'SOLUSDT');
      await undo();
      assert.deepEqual(await tickers(), ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
      assert.equal(await title(), 'SOLUSDT');
      assert.equal(await page.locator('.watch-undo').count(), 0);
      await page.reload();
      assert.deepEqual(await tickers(), ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);

      // Re-adding from the open chart must invalidate its old undo receipt.
      await open('ETHUSDT');
      await remove('ETHUSDT');
      await page.getByRole('button', { name: '加入自选', exact: true }).click();
      assert.equal(await page.locator('.watch-undo').count(), 0);
      assert.deepEqual(await tickers(), ['BTCUSDT', 'SOLUSDT', 'ETHUSDT']);
      for (const ticker of await tickers()) { await open(ticker); await remove(ticker); }
      await page.getByText('暂无自选交易对', { exact: true }).waitFor();
      await page.getByRole('button', { name: '搜索并添加交易对', exact: true }).click();
      assert(await page.getByRole('combobox', { name: '搜索币种 / USDT交易对', exact: true }).evaluate(el => el === document.activeElement));
      await undo();
      assert.deepEqual(await tickers(), ['ETHUSDT']);
      await undo();
      await undo();
      assert.deepEqual(await tickers(), ['BTCUSDT', 'SOLUSDT', 'ETHUSDT']);
      await open('ETHUSDT');
      await remove('ETHUSDT');
      await page.screenshot({ path: `.local/watchlist-undo-${width}.png`, fullPage: true });
      const dimensions = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
      assert(dimensions.scrollWidth <= width + 1);
      await page.getByRole('button', { name: '关闭移除提示', exact: true }).click();
      assert.equal(await page.locator('.watch-undo').count(), 0);
      assert.deepEqual(await tickers(), ['BTCUSDT', 'SOLUSDT']);
      assert((await page.evaluate(()=>JSON.parse(localStorage.getItem('crypto-dashboard-watchlist:v1')).state.watchlist)).some(s=>s.ticker==='AAPL'));
      await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('tab',{name:'自选备份',exact:true}).click();
      const panel=page.locator('#settings-panel-data'),pendingDownload=page.waitForEvent('download');await panel.getByRole('button',{name:'导出自选',exact:true}).click();
      const backup=JSON.parse(fs.readFileSync(await(await pendingDownload).path(),'utf8'));assert.equal(backup.stocks.length,2);assert(backup.stocks.every(s=>s.market==='CRYPTO'));
      const mixed={format:'zpboard-watchlist',version:1,stocks:[{ticker:'btcusdt',name:'duplicate',market:'CRYPTO'},{ticker:'ETHUSDT',name:'Ethereum',market:'CRYPTO'},{ticker:'ETHUSDT',name:'duplicate',market:'CRYPTO'},{ticker:'600519',name:'Legacy CN',market:'CN'},{ticker:'MSFT',name:'Legacy US',market:'US'}]};
      const upload=content=>panel.locator('input[type=file]').setInputFiles({name:'watchlist.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(content))});
      await upload(mixed);await panel.getByText('新增 1 个自选交易对',{exact:true}).waitFor();await panel.getByText('跳过 2 个非USDT现货标的',{exact:true}).waitFor();await panel.getByText('跳过 2 个重复标的',{exact:true}).waitFor();
      await panel.getByRole('button',{name:'确认导入',exact:true}).click();await panel.getByText('已导入 1 个自选交易对',{exact:true}).waitFor();
      const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('crypto-dashboard-watchlist:v1')).state.watchlist);
      assert(stored.some(s=>s.ticker==='AAPL'));assert(!stored.some(s=>['600519','MSFT'].includes(s.ticker)));
      await upload({...mixed,stocks:[{ticker:'MSFT',name:'Legacy US',market:'US'}]});await panel.getByText('没有可导入的USDT现货交易对',{exact:true}).waitFor();assert(await panel.getByRole('button',{name:'确认导入',exact:true}).isDisabled());
      await page.getByRole('button',{name:'关闭设置',exact:true}).click();await page.reload();assert.deepEqual(await tickers(),['BTCUSDT','SOLUSDT','ETHUSDT']);
      assert.deepEqual(errors, []);
      report.push({ width, dimensions, errors, cryptoOnlyVisible:true, legacyRowsPreserved:true, cryptoBackupExport:true, mixedImportPreviewAndCounts:true, nonCryptoOnlyImportDisabled:true, reloadPreservesCryptoList:true, restoredOrder: ['BTCUSDT', 'SOLUSDT', 'ETHUSDT'] });
      await page.close();
    }
    fs.writeFileSync(process.env.REPORT_PATH||'reports/crypto-watchlist-check.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
