const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict'), fs = require('node:fs');
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:5176';

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 850 } });
  const page = await context.newPage();
  const counts = {}, prices = new Set(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('websocket', socket => socket.on('framereceived', frame => {
    try { const message = JSON.parse(String(frame.payload)); counts[message.type] = (counts[message.type] || 0) + 1;
      if (message.type === 'update' && message.data.ticker === 'BTCUSDT') prices.add(message.data.price);
    } catch {}
  }));
  const geometry = () => page.evaluate(() => ({ scroll: scrollY,
    stats: document.querySelector('.key-stats').getBoundingClientRect().top,
    chart: document.querySelector('.chart-card').getBoundingClientRect().height,
    book: document.querySelector('.order-book').getBoundingClientRect().height }));
  try {
    await page.goto(base + '/?view=overview&market=CRYPTO&ticker=BTCUSDT&period=1d&chart=line', { timeout: 90000 });
    await page.locator('.chart-price-line').waitFor({ timeout: 90000 });
    await page.waitForFunction(() => document.querySelector('.book-row strong')?.textContent !== '--', null, { timeout: 60000 });
    await page.waitForTimeout(2500);
    assert.equal(await page.locator('.book-row').count(), 20);
    await page.evaluate(() => { scrollTo(0, 600); window.scrollSamples = []; window.geometryTimer = setInterval(() =>
      window.scrollSamples.push({ y: scrollY, stats: document.querySelector('.key-stats').getBoundingClientRect().top }), 40); });
    const before = await geometry();
    const initialCounts = { ...counts }, start = Date.now();
    await page.route('**/stocks/BTCUSDT/history?**', route => route.fulfill({ status: 503,
      contentType: 'application/json', body: JSON.stringify({ detail: 'controlled refresh failure' }) }));
    await page.locator('.resource-error').waitFor({ timeout: 20000 });
    await page.waitForTimeout(5000);
    const afterFailure = await geometry();
    const seconds = (Date.now() - start) / 1000;
    const messages = Object.fromEntries(Object.entries(counts).map(([key, n]) => [key, n - (initialCounts[key] || 0)]));
    assert.equal(afterFailure.scroll, before.scroll, 'refresh failure moved the page scroll');
    assert.equal(afterFailure.stats, before.stats, 'refresh failure moved content');
    assert.equal(afterFailure.chart, before.chart);
    await page.unroute('**/stocks/BTCUSDT/history?**');
    await page.getByRole('button', { name: '重试图表', exact: true }).evaluate(e => e.click());
    await page.locator('.resource-error').waitFor({ state: 'detached', timeout: 25000 });
    const afterRecovery = await geometry();
    assert.equal(afterRecovery.scroll, before.scroll);
    assert.equal(afterRecovery.stats, before.stats);
    const samples = await page.evaluate(() => { clearInterval(window.geometryTimer); return window.scrollSamples; });
    assert.equal(Math.max(...samples.map(s => s.y)) - Math.min(...samples.map(s => s.y)), 0);
    assert.equal(Math.max(...samples.map(s => s.stats)) - Math.min(...samples.map(s => s.stats)), 0);
    assert((messages.depth || 0) > seconds * 3, 'native depth should exceed REST polling frequency');
    assert((messages.candle || 0) >= 1, 'native candles missing');
    const depthBeforeOffline = counts.depth;
    await context.setOffline(true); await page.waitForTimeout(1500); await context.setOffline(false);
    for (let i = 0; i < 40 && counts.depth <= depthBeforeOffline; i++) await page.waitForTimeout(500);
    assert(counts.depth > depthBeforeOffline, 'native stream did not recover');
    await page.getByRole('button', { name: 'K线', exact: true }).click();
    await page.locator('.professional-canvas canvas').first().waitFor({ timeout: 60000 });
    await page.waitForTimeout(2500);
    assert.equal(errors.length, 0, errors.join('\n'));
    const report = { url: base, viewport: '1440x850', before, afterFailure, afterRecovery,
      seconds, messages, depthHz: Number(((messages.depth || 0) / seconds).toFixed(2)),
      distinctPrices: prices.size, scrollRange: 0, contentMovement: 0, reconnect: true, candlesRendered: true, errors };
    fs.writeFileSync(process.env.REPORT_PATH || 'reports/realtime-desktop-check.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally { await context.close(); await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
