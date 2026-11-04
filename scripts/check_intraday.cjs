const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { readyCandles } = require('./chart_assertions.cjs');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [], results = [], layouts = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.PREVIEW_URL || 'http://127.0.0.1:5173');
    await page.locator('.market-chart[data-period="1d"]').waitFor({ timeout: 30000 });
    assert.equal(await page.getByRole('button', { name: '分时', exact: true }).getAttribute('class'), 'active');
    for (const ticker of ['600519', 'AAPL']) {
      await page.locator('.watch-select').filter({ hasText: ticker }).click();
      for (const [label, period] of [['分时', '1d'], ['五日', '5d']]) {
        await page.getByRole('button', { name: label, exact: true }).click();
        const chart = page.locator(`.market-chart[data-period="${period}"]`);
        await chart.waitFor({ timeout: 30000 });
        const count = Number(await chart.getAttribute('data-points'));
        const sessions = Number(await chart.getAttribute('data-sessions'));
        assert(count >= (ticker === '600519' ? 240 : 390) * (period === '5d' ? 5 : 1));
        assert.equal(sessions, period === '5d' ? 5 : 1);
        const path = await chart.locator('.chart-price-line').getAttribute('d');
        const segments = (path.match(/M/g) ?? []).length;
        assert.equal(segments, sessions);
        assert.equal(await chart.locator('.chart-area').count(), sessions);
        assert.equal(await chart.locator('.session-divider').count(), sessions - 1);
        assert.equal(await chart.locator('.candle').count(), 0);
        assert.equal(await chart.locator('path[d*="NaN"],path[d*="Infinity"]').count(), 0);
        if (ticker === '600519') assert.equal(await chart.locator('[data-overlay="VWAP"]').count(), 1);
        results.push({ ticker, period, points: count, sessions, price_segments: segments });
      }
    }
    for (const width of [375, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const size = await page.evaluate(() => ({ viewport: innerWidth, page: document.documentElement.scrollWidth }));
      assert(size.page <= size.viewport + 1);
      layouts.push(size);
      await page.screenshot({ path: `.local/intraday-five-${width}.png`, fullPage: true });
    }
    await page.getByRole('button', { name: 'K线', exact: true }).click();
    await page.locator(`${readyCandles}[data-period="1mo"]`).waitFor({ timeout: 30000 });
    assert.equal(await page.getByRole('button', { name: '1月', exact: true }).getAttribute('class'), 'active');
    await page.getByRole('button', { name: '折线', exact: true }).click();
    await page.getByRole('button', { name: '五日', exact: true }).click();
    await page.locator('.market-chart[data-period="5d"]').waitFor({ timeout: 30000 });
    assert.equal(await page.getByRole('button', { name: '折线', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('tab', { name: '语言', exact: true }).click();
    await page.getByRole('button', { name: 'English', exact: true }).click();
    await page.getByRole('button', { name: 'Close settings' }).click();
    assert.equal(await page.getByRole('button', { name: '5 days', exact: true }).getAttribute('class'), 'active');
    await page.getByRole('button', { name: 'Intraday', exact: true }).click();
    await page.locator('.market-chart[data-period="1d"]').waitFor({ timeout: 30000 });
    assert.equal(await page.locator('.chart-readout em').getAttribute('title'), 'Vs prev. close');
    assert.deepEqual(errors, []);
    const report = { checked_at: new Date().toISOString(), live_results: results, layouts,
      daily_candles_separate_from_intraday: true, bilingual_periods: true, javascript_errors: errors };
    fs.writeFileSync('reports/intraday-browser-check.json', JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
