const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { readyCandles } = require('./chart_assertions.cjs');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 960 } });
    const errors = [], layouts = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.PREVIEW_URL || 'http://127.0.0.1:5173');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('tab', { name: '个性化', exact: true }).click();
    await page.getByRole('button', { name: '浅色', exact: true }).click();
    await page.getByRole('button', { name: '关闭设置', exact: true }).click();
    await page.getByRole('button', { name: 'K线', exact: true }).click();
    await page.locator(readyCandles).waitFor({ timeout: 30000 });
    assert.equal(await page.locator('.chart-card .analysis-toolbar').count(), 0);
    assert.equal(await page.locator('.chart-header').getByRole('button', { name: 'AI 分析', exact: true }).count(), 1);
    for (const size of [1920, 1440, 1200, 1024, 375]) {
      await page.setViewportSize({ width: size, height: 1000 });
      await page.waitForFunction(() => {
        const canvas = document.querySelector('.professional-canvas');
        const table = canvas.querySelector('table');
        return table && Math.abs(canvas.getBoundingClientRect().width - table.getBoundingClientRect().width) <= 2;
      });
      const layout = await page.evaluate(() => {
        const canvas = document.querySelector('.professional-canvas');
        const price = canvas.getBoundingClientRect();
        const toolbar = document.querySelector('.chart-header').getBoundingClientRect();
        const tools = document.querySelector('.professional-tools');
        const toolBox = tools.getBoundingClientRect();
        const toolsFit = [...tools.querySelectorAll('button')].every(button => {
          const box = button.getBoundingClientRect();
          return box.left >= toolBox.left && box.right <= toolBox.right + 1 && box.bottom <= toolBox.bottom + 1;
        });
        return { viewport: innerWidth, page: document.documentElement.scrollWidth, width: price.width, height: price.height,
          toolbarHeight: toolbar.height, toolsFit, canvasLayers: canvas.querySelectorAll('canvas').length };
      });
      assert(layout.page <= layout.viewport + 1);
      assert(layout.toolsFit && layout.canvasLayers > 1, JSON.stringify(layout));
      layouts.push(layout);
      await page.screenshot({ path: `.local/chart-presentation-candles-${size}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: '折线', exact: true }).click();
    await page.locator('.chart-price-line').waitFor();
    await page.screenshot({ path: '.local/chart-presentation-line.png', fullPage: true });
    await page.getByRole('button', { name: '五日', exact: true }).click();
    await page.locator('.market-chart[data-period="5d"]').waitFor({ timeout: 30000 });
    const path = await page.locator('.chart-price-line').getAttribute('d');
    assert.equal((path.match(/M/g) ?? []).length, 5);
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('tab', { name: '个性化', exact: true }).click();
    await page.getByRole('button', { name: '深色', exact: true }).click();
    await page.getByRole('button', { name: '红涨绿跌', exact: true }).click();
    await page.getByRole('tab', { name: '语言', exact: true }).click();
    await page.getByRole('button', { name: 'English', exact: true }).click();
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    await page.screenshot({ path: '.local/chart-presentation-dark-five.png', fullPage: true });
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    assert.equal(await page.locator('html').getAttribute('data-price-colors'), 'red-up');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.equal(await page.locator('path[d*="NaN"],path[d*="Infinity"]').count(), 0);
    assert.deepEqual(errors, []);
    const report = { checked_at: new Date().toISOString(), engine: 'lightweight-charts',
      toolbar_merged: true, five_day_segments: 5, theme_and_language_switch: true, layouts, javascript_errors: errors };
    fs.writeFileSync('reports/chart-presentation-browser-check.json', JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
