const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.PREVIEW_URL || 'http://127.0.0.1:5173');
    const metric = name => page.locator('.metric').filter({ has: page.locator('span').filter({ hasText: new RegExp(`^${name}$`) }) }).locator('strong');
    await page.locator('.watch-select').filter({ hasText: '600519' }).click();
    await page.locator('.key-stats').waitFor();
    assert.equal(await page.locator('.metric').count(), 12);
    await page.waitForFunction(() => [...document.querySelectorAll('.metric')].find(el => el.querySelector('span')?.textContent === '量比')?.querySelector('strong')?.textContent !== '--');
    const cn = await page.request.get(new URL('/api/v1/stocks/600519/quote', page.url()).href).then(r => r.json());
    assert(cn.volume_ratio !== null && cn.pe_ratio !== null && cn.pb_ratio !== null && cn.market_cap > 0);
    assert.equal(await metric('量比').innerText(), cn.volume_ratio.toFixed(2));
    assert.equal(await metric('市盈率').innerText(), cn.pe_ratio.toFixed(2));
    assert.equal(await metric('市净率').innerText(), cn.pb_ratio.toFixed(2));
    assert.match(await metric('振幅').innerText(), /^\d+\.\d{2}%$/);
    const layouts = [];
    for (const width of [375, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const size = await page.evaluate(() => ({ viewport: innerWidth, page: document.documentElement.scrollWidth }));
      assert(size.page <= size.viewport + 1, JSON.stringify(size));
      for (const item of await page.locator('.metric').all()) assert(await item.isVisible());
      layouts.push(size);
      await page.screenshot({ path: `.local/quote-metrics-${width}.png`, fullPage: true });
    }
    await page.locator('.watch-select').filter({ hasText: 'AAPL' }).click();
    await page.waitForFunction(() => document.querySelector('.instrument-title h1')?.textContent === 'Apple Inc.');
    const us = await page.request.get(new URL('/api/v1/stocks/AAPL/quote', page.url()).href).then(r => r.json());
    assert(us.pe_ratio !== null && us.market_cap > 0);
    assert.equal(us.volume_ratio, null);
    assert.equal(await metric('量比').innerText(), '--');
    await page.waitForFunction(() => [...document.querySelectorAll('.metric')].find(el => el.querySelector('span')?.textContent === '市盈率')?.querySelector('strong')?.textContent !== '--');
    assert.equal(await metric('市盈率').innerText(), us.pe_ratio.toFixed(2));
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('tab', { name: '语言', exact: true }).click();
    await page.getByRole('button', { name: 'English', exact: true }).click();
    await page.getByRole('button', { name: 'Close settings' }).click();
    assert.equal(await metric('P/E').innerText(), us.pe_ratio.toFixed(2));
    assert.equal(await metric('Volume ratio').innerText(), '--');
    assert.match(await metric('Market cap').innerText(), /^\$/);
    assert.deepEqual(errors, []);
    const fields = quote => Object.fromEntries(['ticker','source','as_of','volume_ratio','pe_ratio','pb_ratio','market_cap'].map(k => [k, quote[k]]));
    const report = { checked_at: new Date().toISOString(), metric_count: 12, live_cn: fields(cn), live_us: fields(us),
      no_cross_market_value_leak: true, bilingual_labels: true, layouts, javascript_errors: errors };
    fs.writeFileSync('reports/quote-metrics-browser-check.json', JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
