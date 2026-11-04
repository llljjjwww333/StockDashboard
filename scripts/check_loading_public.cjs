const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { readyCandles, candleCount } = require('./chart_assertions.cjs');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [], timings = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', response => {
      if (response.url().includes('/history?')) timings.push({ url: response.url(), status: response.status(), responseMs: response.request().timing().responseStart });
    });
    const start = Date.now();
    const base = process.env.PREVIEW_URL || fs.readFileSync('.local/public-preview-url.txt', 'utf8').trim();
    await page.goto(base + '/?v=loading-20261104');
    await page.locator('.market-chart[data-period="1d"]').waitFor({ timeout: 45000 });
    const firstChartMs = Date.now() - start;
    await page.getByRole('button', { name: '五日', exact: true }).click();
    await page.locator('.market-chart[data-period="5d"]').waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: 'K线', exact: true }).click();
    await page.locator(`${readyCandles}[data-period="1mo"]`).waitFor({ timeout: 30000 });
    assert.equal(await page.getByRole('button', { name: '五日', exact: true }).count(), 0);
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'K线', exact: true }).click();
    assert(await candleCount(page) > 1);
    await page.getByRole('button', { name: '3月', exact: true }).click();
    await page.locator(`${readyCandles}[data-period="3mo"]`).waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: '折线', exact: true }).click();
    await page.getByRole('button', { name: '五日', exact: true }).click();
    await page.locator('.market-chart[data-period="5d"]').waitFor();
    const cachedStart = Date.now();
    await page.getByRole('button', { name: 'K线', exact: true }).click();
    await page.locator(`${readyCandles}[data-period="3mo"]`).waitFor();
    const cachedReturnMs = Date.now() - cachedStart;
    const layouts = [];
    for (const width of [375, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const layout = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
      assert(layout.content <= layout.viewport + 1);
      layouts.push(layout);
    }
    await page.screenshot({ path: '.local/loading-public.png', fullPage: true });
    assert.deepEqual(errors, []);
    const result = { checked_at: new Date().toISOString(), firstChartMs, cachedReturnMs,
      repeated_candle_clicks_stay_candles: true, previous_daily_range_restored: true, layouts, timings, javascript_errors: errors };
    fs.writeFileSync('reports/loading-public-check.json', JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
