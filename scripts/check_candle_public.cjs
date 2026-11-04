const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { readyCandles, candleCount } = require('./chart_assertions.cjs');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 1000 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const base = process.env.PREVIEW_URL || fs.readFileSync('.local/public-preview-url.txt', 'utf8').trim();
    await page.goto(base + '/?v=professional-20261103');
    await page.locator('.market-chart').waitFor({ timeout: 45000 });
    await page.getByRole('button', { name: 'K线', exact: true }).click();
    const selector = page.getByRole('combobox', { name: 'K线周期', exact: true });
    assert.equal(await selector.inputValue(), '1d');
    await page.locator(`${readyCandles}[data-interval="1d"]`).waitFor({ timeout: 30000 });
    await selector.selectOption('1m');
    await page.locator(`${readyCandles}[data-interval="1m"]`).waitFor({ timeout: 30000 });
    const usMinute = await candleCount(page);
    await page.locator('.watch-select').filter({ hasText: '600519' }).click();
    await selector.selectOption('5m');
    await page.getByRole('group', { name: '时间范围', exact: true }).getByRole('button', { name: '五日', exact: true }).click();
    await page.locator(`${readyCandles}[data-period="5d"][data-interval="5m"]`).waitFor({ timeout: 30000 });
    await page.waitForFunction(() => document.querySelector('.chart-readout span')?.textContent === '600519');
    assert.equal(await page.locator('.market-chart').getAttribute('data-sessions'), '5');
    const cnMinute = await candleCount(page);
    await page.screenshot({ path: '.local/candle-public.png', fullPage: true });
    await page.reload();
    await page.locator(`${readyCandles}[data-period="5d"][data-interval="5m"]`).waitFor({ timeout: 30000 });
    await selector.dispatchEvent('keydown', { key: '2', code: 'Digit2', bubbles: true });
    assert.equal(new URL(page.url()).searchParams.get('view'), 'overview');
    await selector.selectOption('1d');
    await page.locator(`${readyCandles}[data-period="1mo"][data-interval="1d"]`).waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: '折线', exact: true }).click();
    await page.getByRole('button', { name: '五日', exact: true }).click();
    await page.locator('.market-chart[data-period="5d"][data-mode="line"]').waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: 'K线', exact: true }).click();
    await page.locator('.market-chart[data-period="1mo"][data-mode="candles"]').waitFor();
    assert.deepEqual(errors, []);
    const report = { checked_at: new Date().toISOString(), us_one_minute_candles: usMinute,
      cn_five_minute_candles_five_sessions: cnMinute, daily_selection: true, no_unexpected_five_day_jump: true,
      selection_survives_reload: true, focused_select_does_not_navigate: true, javascript_errors: errors };
    fs.writeFileSync('reports/candle-intervals-public-check.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
