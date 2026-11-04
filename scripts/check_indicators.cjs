const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { readyCandles, candleCount } = require('./chart_assertions.cjs');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('button', { name: '1月', exact: true }).click();
  await page.locator('.price-svg').waitFor({ timeout: 25000 });
  await page.getByRole('button', { name: /^指标/ }).click();
  const menu = page.getByRole('group', { name: '指标选择' });
  assert.equal(await menu.getByRole('checkbox').count(), 15);
  for (const checkbox of await menu.getByRole('checkbox').all()) await checkbox.check();
  await page.getByRole('button', { name: /^指标/ }).click();
  assert.equal(await page.locator('.price-overlay').count(), 9);
  assert.equal(await page.locator('.indicator-panel').count(), 7);
  await page.locator('.indicator-legend span').filter({ hasText: /^MA60 \d/ }).waitFor({ timeout: 25000 });
  assert.equal(await page.locator('path[d*="NaN"],path[d*="Infinity"]').count(), 0);
  await page.screenshot({ path: '.local/indicators-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'K线', exact: true }).click();
  await page.locator(readyCandles).waitFor();
  assert(await candleCount(page) > 1);
  await page.locator('.professional-canvas').hover({ position: { x: 120, y: 50 } });
  await page.reload();
  await page.getByRole('button', { name: '1月', exact: true }).click();
  await page.locator(readyCandles).waitFor({ timeout: 25000 });
  assert.equal(await page.locator('.professional-chart').getAttribute('data-pane-count'), '9');
  const layouts = [];
  for (const width of [375, 1024]) {
    await page.setViewportSize({ width, height: 1000 });
    const size = await page.evaluate(() => ({ viewport: innerWidth, page: document.documentElement.scrollWidth }));
    assert(size.page <= size.viewport + 1, JSON.stringify(size));
    layouts.push(size);
    await page.screenshot({ path: `.local/indicators-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: /^指标/ }).click();
    const bounds = await menu.boundingBox();
    assert(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
    await page.getByRole('button', { name: /^指标/ }).click();
  }
  await page.getByRole('button', { name: /^指标/ }).click();
  await menu.getByRole('checkbox', { name: '成交量', exact: true }).uncheck();
  await page.getByRole('button', { name: /^指标/ }).click();
  assert.equal(await page.locator('.professional-chart').getAttribute('data-volume-enabled'), 'false');
  await page.getByRole('button', { name: /^指标/ }).click();
  await menu.getByRole('button', { name: '重置' }).click();
  await page.getByRole('button', { name: /^指标/ }).click();
  assert.equal(await page.locator('.professional-chart').getAttribute('data-overlay-count'), '1');
  assert.equal(await page.locator('.professional-chart').getAttribute('data-pane-count'), '2');
  assert.equal(await page.locator('.professional-chart').getAttribute('data-volume-enabled'), 'true');
  assert.equal(errors.length, 0, errors.join('\n'));
  const report = { checked_at: new Date().toISOString(), options: 15, main_overlay_lines: 9, subpanels: 7,
    warmup_ma60: true, candlesticks: true, saved_across_reload: true, volume_toggle: true, reset: true,
    layouts, javascript_errors: errors };
  fs.writeFileSync('reports/indicators-browser-check.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
