const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { readyCandles, candleCount } = require('./chart_assertions.cjs');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [], results = [], layouts = [], analyses = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      localStorage.setItem('marketdesk:ai-profiles:v1', JSON.stringify({ activeId: 'fixture', profiles: [{ id: 'fixture', name: 'Browser fixture', baseUrl: 'https://fixture.example/v1', model: 'fixture', protocol: 'chat', updatedAt: 1 }] }));
      sessionStorage.setItem('marketdesk:ai-keys:v1', JSON.stringify({ fixture: 'controlled-test-key' }));
    });
    await page.route('**/api/v1/ai/analyze', async route => {
      const request = route.request().postDataJSON();
      analyses.push({ period: request.period, interval: request.interval, chart_type: request.chart_type });
      await route.fulfill({ json: { scope: 'chart', ticker: request.ticker, period: request.period, interval: request.interval,
        provider: 'Controlled fixture', model: 'fixture', analyzed_at: new Date().toISOString(), summary: 'Minute analysis fixture',
        outlook: '', drivers: [], watch: [], annotations: [], data: [], context: { bar_count: 0, news_count: 0, indicators: {}, news_sources: [], news: [] } } });
    });
    await page.goto(process.env.PREVIEW_URL || 'http://127.0.0.1:5175');
    await page.locator('.market-chart[data-mode="line"]').waitFor({ timeout: 45000 });
    await page.getByRole('button', { name: 'K线', exact: true }).click();
    const selector = page.getByRole('combobox', { name: 'K线周期', exact: true });
    assert.equal(await selector.inputValue(), '1d');
    await page.locator(`${readyCandles}[data-interval="1d"]`).waitFor({ timeout: 30000 });
    for (const ticker of ['AAPL', '600519']) {
      await page.locator('.watch-select').filter({ hasText: ticker }).click();
      for (const interval of ['1m', '5m', '15m', '30m', '1h', '1d']) {
        await selector.selectOption(interval);
        const chart = page.locator(`${readyCandles}[data-interval="${interval}"]`);
        await chart.waitFor({ timeout: 30000 });
        // Ticker changes may briefly retain the old chart node until rendering.
        await page.waitForFunction(ticker => document.querySelector('.chart-readout span')?.textContent === ticker, ticker);
        assert.equal(await page.getByRole('button', { name: 'K线', exact: true }).getAttribute('aria-pressed'), 'true');
        const count = await candleCount(page);
        assert(count > 0);
        assert.equal(await chart.locator('.chart-price-line').count(), 0);
        assert.equal(await page.locator('path[d*="NaN"],path[d*="Infinity"]').count(), 0);
        results.push({ ticker, interval, candles: count });
      }
    }
    await selector.selectOption('5m');
    await page.getByRole('group', { name: '时间范围', exact: true }).getByRole('button', { name: '五日', exact: true }).click();
    await page.locator('.market-chart[data-period="5d"][data-interval="5m"]').waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: 'K线', exact: true }).click();
    assert.equal(await page.locator('.market-chart').getAttribute('data-period'), '5d');
    await page.getByRole('button', { name: /^指标/ }).click();
    assert.equal(await page.getByRole('checkbox', { name: 'ATR(14)', exact: true }).isEnabled(), true);
    await page.getByRole('checkbox', { name: 'ATR(14)', exact: true }).check();
    await page.getByRole('button', { name: /^指标/ }).click();
    await page.locator('.professional-chart[data-pane-count="3"]').waitFor();
    await selector.selectOption('1m');
    await page.locator('.market-chart[data-period="1d"][data-interval="1m"]').waitFor({ timeout: 30000 });
    assert.equal(await page.getByRole('button', { name: '五日', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'AI 分析', exact: true }).click();
    await page.locator('.analysis-summary').waitFor();
    assert.deepEqual(analyses[0], { period: '1d', interval: '1m', chart_type: 'candles' });
    await page.getByRole('button', { name: '折线', exact: true }).click();
    await page.locator('.market-chart[data-mode="line"]').waitFor({ timeout: 30000 });
    assert.equal(await page.locator('.analysis-summary').count(), 0);
    assert.equal(await page.locator('.candle').count(), 0);
    await page.getByRole('button', { name: 'K线', exact: true }).click();
    await page.locator('.market-chart[data-mode="candles"][data-interval="1m"]').waitFor();
    for (const width of [375, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const layout = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
      assert(layout.content <= layout.viewport + 1);
      layouts.push(layout);
      await page.screenshot({ path: `.local/candle-intervals-${width}.png`, fullPage: true });
    }
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('tab', { name: '语言', exact: true }).click();
    await page.getByRole('button', { name: 'English', exact: true }).click();
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    const english = page.getByRole('combobox', { name: 'Candle interval', exact: true });
    assert.equal(await english.locator('option[value="1d"]').textContent(), 'Daily');
    assert.equal(await english.locator('option[value="15m"]').textContent(), '15 min');
    assert.deepEqual(errors, []);
    const report = { checked_at: new Date().toISOString(), results, layouts, controlled_analysis_requests: analyses,
      same_interval_analysis_cleared_on_chart_type_change: true, minute_indicators_enabled: true, english_labels: true, javascript_errors: errors };
    fs.writeFileSync('reports/candle-intervals-browser-check.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
