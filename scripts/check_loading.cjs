// Delayed/held responses verify cache rendering without depending on a fast network.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { readyCandles, candleCount } = require('./chart_assertions.cjs');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let hold = false;
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 1000 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const bar = (timestamp, close) => ({ timestamp, open: close - 1, high: close + 2, low: close - 2, close, volume: 1000 });
    await page.route('**/api/v1/stocks/*/history?*', async route => {
      const period = new URL(route.request().url()).searchParams.get('period');
      if (hold) await held;
      else await new Promise(resolve => setTimeout(resolve, period === '1mo' ? 900 : 200));
      const data = period === '1mo' ? [bar('2026-11-02T00:00:00-05:00', 101)]
        : period === '1d' ? [bar('2026-10-30T09:30:00-04:00', 111), bar('2026-10-30T09:31:00-04:00', 112)]
        : period === '5d' ? [26, 27, 28, 29, 30].flatMap(day => [bar(`2026-10-${day}T09:30:00-04:00`, 120), bar(`2026-10-${day}T09:31:00-04:00`, 121)])
        : Array.from({ length: period === '3mo' ? 12 : 80 }, (_, i) => bar(new Date(Date.UTC(2026, 7, 1 + i)).toISOString(), 140 + i));
      try { await route.fulfill({ json: { ticker: 'AAPL', data, source: 'CONTROLLED LOADING FIXTURE', interval: ['1d','5d'].includes(period) ? '1m' : '1d', price_type: 'ohlc' } }); } catch { /* A reload can discard an earlier held request. */ }
    });
    await page.goto('http://127.0.0.1:5173');
    await page.locator('.market-chart[data-period="1d"]').waitFor();
    const first = Date.now();
    await page.getByRole('button', { name: 'K线', exact: true }).click();
    await page.locator(`${readyCandles}[data-period="1mo"]`).waitFor();
    const coldDailyMs = Date.now() - first;
    assert.equal(await candleCount(page), 1);
    assert.equal(await page.locator('.chart-empty').count(), 0);
    assert.equal(await page.getByRole('button', { name: '五日', exact: true }).count(), 0);
    assert.equal(await page.locator('.professional-chart').getAttribute('data-volume-enabled'), 'true');
    assert((await page.locator('.professional-canvas').boundingBox()).width > 0);
    await page.getByRole('button', { name: '3月', exact: true }).click();
    await page.locator(`${readyCandles}[data-period="3mo"]`).waitFor();
    assert.equal(await candleCount(page), 12);
    await page.getByRole('button', { name: '折线', exact: true }).click();
    await page.getByRole('button', { name: '五日', exact: true }).click();
    await page.locator('.market-chart[data-period="5d"]').waitFor();
    hold = true;
    const back = Date.now();
    await page.getByRole('button', { name: 'K线', exact: true }).click();
    await page.locator(`${readyCandles}[data-period="3mo"]`).waitFor({ timeout: 1500 });
    const cachedReturnMs = Date.now() - back;
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'K线', exact: true }).click();
    assert.equal(await page.locator('.market-chart').getAttribute('data-period'), '3mo');
    assert.equal(await page.getByRole('button', { name: 'K线', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.locator('.primary-nav').getByRole('button', { name: '市场', exact: true }).click();
    await page.locator('.primary-nav').getByRole('button', { name: '研究台', exact: true }).click();
    await page.locator(`${readyCandles}[data-period="3mo"]`).waitFor({ timeout: 1500 });
    const reload = Date.now();
    await page.reload();
    await page.locator(`${readyCandles}[data-period="3mo"]`).waitFor({ timeout: 3000 });
    const restoredAfterReloadMs = Date.now() - reload;
    await page.getByRole('button', { name: '1月', exact: true }).click();
    await page.locator(`${readyCandles}[data-period="1mo"]`).waitFor({ timeout: 1500 });
    assert.equal(await candleCount(page), 1);
    await page.screenshot({ path: '.local/loading-single-bar.png', fullPage: true });
    assert.equal(await page.locator('path[d*="NaN"],path[d*="Infinity"]').count(), 0);
    hold = false;
    release();
    assert.deepEqual(errors, []);
    const report = { checked_at: new Date().toISOString(), scope: 'Controlled delayed and held history responses',
      cold_daily_ms: coldDailyMs, cached_return_ms: cachedReturnMs, session_restore_ms: restoredAfterReloadMs,
      rendered_while_network_held: true, single_bar_drawn: true, mode_kept_after_navigation: true,
      repeated_candle_clicks_stay_candles: true, javascript_errors: errors };
    fs.writeFileSync('reports/loading-browser-check.json', JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally { release(); await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
