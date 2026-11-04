const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { readyCandles, candleCount } = require('./chart_assertions.cjs');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const errors = [];
  const sizes = [];
  const base = 'http://127.0.0.1:5173';
  const checkWidth = async (page, view) => {
    const size = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
    assert(size.document <= size.viewport + 1, `${view}: ${JSON.stringify(size)}`);
    sizes.push({ view, ...size });
  };
  for (const width of [375, 768, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.locator('.market-chart svg').waitFor({ timeout: 25000 });
    await page.getByRole('button', { name: 'K线', exact: true }).click();
    await page.locator(readyCandles).waitFor();
    assert(await candleCount(page) > 1);
    assert.equal(await page.locator('.professional-chart').getAttribute('data-overlay-count'), '1');
    await checkWidth(page, 'overview');
    await page.screenshot({ path: `reports/ux-${width}.png`, fullPage: true });
    await page.locator('.primary-nav button').filter({ hasText: '市场' }).click();
    await page.getByRole('button', { name: '中国市场', exact: true }).click();
    await page.locator('.cn-index-card.featured').getByText('上证指数', { exact: true }).waitFor({ timeout: 20000 });
    await checkWidth(page, 'markets');
    if (width === 375) await page.screenshot({ path: 'reports/ux-mobile-markets.png', fullPage: true });
    await page.locator('.primary-nav button').filter({ hasText: '情报' }).click();
    await page.locator('.news-feed > div > button').first().waitFor({ timeout: 20000 });
    await page.getByLabel('筛选财经新闻').fill('zzzz-no-story-zzzz');
    await page.getByText('没有匹配结果', { exact: true }).waitFor();
    await page.getByRole('button', { name: '清除筛选', exact: true }).click();
    await page.locator('.news-feed > div > button').first().waitFor();
    await checkWidth(page, 'news');
    if (width === 375) await page.screenshot({ path: 'reports/ux-mobile-news.png', fullPage: true });
    // The market selector controls search scope.
    assert.equal(await page.locator('.market-context button[aria-pressed="true"]').innerText(), 'A 股');
    await page.getByRole('combobox', { name: '搜索股票' }).fill('510300');
    await page.getByRole('option').filter({ hasText: '510300' }).waitFor({ timeout: 10000 });
    await page.getByRole('combobox', { name: '搜索股票' }).press('Enter');
    await page.locator('.instrument-title h1').filter({ hasText: 'ETF' }).waitFor();
    await page.reload();
    assert((await page.locator('.watch-items').innerText()).includes('510300'));
    await page.close();
  }

  const search = await browser.newPage();
  search.on('pageerror', error => errors.push(error.message));
  await search.goto(base);
  await search.getByRole('combobox', { name: '搜索股票' }).fill('AMD');
  await search.getByRole('option').filter({ hasText: 'AMD' }).first().waitFor({ timeout: 10000 });
  await search.getByRole('combobox', { name: '搜索股票' }).press('Enter');
  await search.locator('.instrument-title strong').filter({ hasText: /^AMD$/ }).waitFor();
  await search.close();

  // Controlled responses verify live-snapshot consistency and slow-HTTP races.
  const fixture = await browser.newPage();
  fixture.on('pageerror', error => errors.push(error.message));
  const quote = { ticker: 'AAPL', price: 123, volume: 777, change_percent: 2.5, previous_close: 120,
    open_price: 119, high_price: 140, low_price: 110, amount: 7654321, turnover_rate: 2.3,
    source: 'TEST FIXTURE', as_of: '2026-11-02T10:00:02-05:00', fetched_at: '2026-11-02T15:00:03Z' };
  await fixture.route('**/api/v1/stocks/AAPL/quote', async route => {
    await new Promise(resolve => setTimeout(resolve, 400));
    await route.fulfill({ json: { ...quote, price: 121, high_price: 125, volume: 10,
      as_of: '2026-11-02T10:00:01-05:00', fetched_at: '2026-11-02T15:00:01Z' } });
  });
  await fixture.routeWebSocket('**/ws/stock-updates', socket => socket.onMessage(raw => {
    const message = JSON.parse(String(raw));
    if (message.type === 'subscribe' && message.data.ticker === 'AAPL') socket.send(JSON.stringify({ type: 'update', data: quote }));
  }));
  await fixture.goto(base);
  await fixture.locator('.hero-quote > strong').filter({ hasText: '$123.00' }).waitFor();
  await fixture.locator('.instrument-title small[title="TEST FIXTURE"]').waitFor();
  await fixture.locator('.market-chart svg').waitFor({ timeout: 20000 });
  assert.equal(await fixture.locator('.hero-quote > strong').innerText(), '$123.00');
  const stats = await fixture.locator('.key-stats').innerText();
  assert(stats.includes('140.00') && stats.includes('110.00') && stats.includes('777') && stats.includes('2.30%'));
  await fixture.close();

  const reading = await browser.newPage({ viewport: { width: 375, height: 900 } });
  await reading.route('**/api/v1/news?*', route => route.fulfill({ json: {
    market: 'ALL', updated_at: new Date().toISOString(), keywords: [],
    items: [{ title: '没有外链的测试新闻', summary: '可以直接在站内阅读正文。', published_at: new Date().toISOString(), source: 'TEST FIXTURE', market: 'ALL', url: null }],
  } }));
  await reading.goto(base + '/?view=news');
  await reading.locator('.news-feed > div > button').first().click();
  await reading.getByRole('dialog').waitFor();
  assert((await reading.getByRole('dialog').innerText()).includes('可以直接在站内阅读正文'));
  await reading.keyboard.press('Escape');
  assert.equal(await reading.getByRole('dialog').count(), 0);
  await reading.close();
  assert.equal(errors.length, 0, errors.join('\n'));
  const report = { checked_at: new Date().toISOString(), responsive_sizes: sizes, javascript_errors: errors,
    candles_and_ma20: true, search_us_and_etf: true, watchlist_reload_persistence: true,
    news_filter: true, no_link_news_dialog_fixture: true, live_snapshot_race_fixture: true };
  fs.writeFileSync('reports/ux-check.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
