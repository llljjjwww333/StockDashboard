// Set PLAYWRIGHT_MODULE to a local Playwright installation, or install playwright.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1536, height: 1000 } });
  const errors = [];
  const failures = [];
  const socketMessages = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.url().includes('/api/') && response.status() >= 400) failures.push({ url: response.url(), status: response.status() });
  });
  page.on('websocket', socket => socket.on('framereceived', frame => {
    try { socketMessages.push(JSON.parse(frame.payload)); } catch { /* Vite HMR frames */ }
  }));
  const base = process.env.DASHBOARD_URL || 'http://127.0.0.1:5173';
  const started = Date.now();
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByText('已连接', { exact: true }).waitFor();
  await page.locator('.hero-quote > strong').filter({ hasText: '$' }).waitFor({ timeout: 20000 });
  const firstQuoteMs = Date.now() - started;
  await page.locator('.market-chart svg').waitFor({ timeout: 20000 });
  fs.mkdirSync('reports', { recursive: true });
  await page.screenshot({ path: 'reports/overview.png', fullPage: true });
  await page.locator('.watch-select').filter({ hasText: '600519' }).click();
  await page.locator('.hero-quote > strong').filter({ hasText: '¥' }).waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: '1年', exact: true }).click();
  await page.locator('.market-chart svg').waitFor({ timeout: 20000 });
  await page.locator('.market-chart svg').hover({ position: { x: 700, y: 100 } });
  await page.getByRole('button', { name: '1日', exact: true }).click();
  await page.locator('.market-chart svg').waitFor({ timeout: 20000 });
  await page.locator('.primary-nav button').filter({ hasText: '市场' }).click();
  await page.getByRole('button', { name: '中国市场', exact: true }).click();
  await page.locator('.index-row button').first().waitFor({ timeout: 20000 });
  await page.screenshot({ path: 'reports/markets.png', fullPage: true });
  await page.locator('.primary-nav button').filter({ hasText: '情报' }).click();
  await page.locator('.news-feed > div > button').first().waitFor({ timeout: 20000 });
  await page.screenshot({ path: 'reports/news.png', fullPage: true });
  const updateTickers = [...new Set(socketMessages.filter(message => message.type === 'update').map(message => message.data.ticker))];
  assert(updateTickers.includes('AAPL'));
  assert(updateTickers.includes('600519'));
  assert.equal(errors.length, 0, errors.join('\n'));

  const outage = await browser.newPage();
  outage.on('pageerror', error => errors.push(error.message));
  await outage.route('**/api/v1/stocks/*/quote', route => route.fulfill({ status: 503, body: '{}' }));
  await outage.route('**/api/v1/stocks/*/history?*', route => route.fulfill({ status: 503, body: '{}' }));
  await outage.routeWebSocket('**/ws/stock-updates', socket => socket.close());
  await outage.goto(base, { waitUntil: 'domcontentloaded' });
  await outage.getByText('行情暂不可用', { exact: true }).waitFor();
  assert.equal(await outage.locator('.hero-quote > strong').innerText(), '--');
  assert.equal(await outage.getByText('已连接', { exact: true }).count(), 0);
  await outage.screenshot({ path: 'reports/outage.png', fullPage: true });
  const report = { checked_at: new Date().toISOString(), first_quote_ms: firstQuoteMs, update_tickers: updateTickers, javascript_errors: errors, api_failures: failures, outage_placeholder_verified: true };
  fs.writeFileSync('reports/browser-check.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
