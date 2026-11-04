// Controlled responses exercise races, keyboard focus, persistence and idle polling.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { candleCount } = require('./chart_assertions.cjs');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = [], requests = [], layouts = [];
    let liveSocket, failHistory = false;
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      localStorage.setItem('marketdesk:ai-profiles:v1', JSON.stringify({ activeId: 'fixture', profiles: [{ id: 'fixture', name: 'Controlled fixture', baseUrl: 'https://fixture.example/v1', model: 'fixture', protocol: 'chat', updatedAt: 1 }] }));
      sessionStorage.setItem('marketdesk:ai-keys:v1', JSON.stringify({ fixture: 'controlled-test-key' }));
      const Original = Intl.DateTimeFormat;
      window.__chartFormats = 0;
      function Counted(...args) {
        if (/(MarketChart|ProfessionalChart)/.test(new Error().stack)) window.__chartFormats++;
        return new Original(...args);
      }
      Object.setPrototypeOf(Counted, Original);
      Counted.prototype = Original.prototype;
      Intl.DateTimeFormat = Counted;
    });
    const quote = { ticker: 'AAPL', price: 123, volume: 1000, change_percent: 2.5, previous_close: 120,
      open_price: 121, high_price: 130, low_price: 119, source: 'CONTROLLED AUDIT',
      as_of: '2026-11-02T10:00:00-05:00', fetched_at: '2026-11-02T15:00:00Z' };
    await page.routeWebSocket('**/ws/stock-updates', socket => socket.onMessage(() => { liveSocket = socket; }));
    const bar = (timestamp, i) => ({ timestamp, open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i, volume: 1000 + i });
    await page.route('**/api/v1/**', async route => {
      const url = new URL(route.request().url());
      requests.push(url.pathname + url.search);
      let json;
      if (url.pathname.endsWith('/history')) {
        if (failHistory) return route.fulfill({ status: 503, json: { detail: 'Controlled outage' } });
        const period = url.searchParams.get('period');
        const interval = url.searchParams.get('interval');
        const minutes = { '1m': 1, '5m': 5, '15m': 15, '30m': 30, '1h': 60 }[interval] || 1;
        const days = period === '5d' ? [26, 27, 28, 29, 30] : [30];
        const data = ['1d', '5d'].includes(period) ? days.flatMap(day => Array.from({ length: Math.floor(390 / minutes) }, (_, i) => {
          const time = 570 + i * minutes;
          return bar(`2026-10-${day}T${String(Math.floor(time / 60)).padStart(2, '0')}:${String(time % 60).padStart(2, '0')}:00-04:00`, i / 100);
        })) : Array.from({ length: period === '1y' ? 180 : 40 }, (_, i) => bar(new Date(Date.UTC(2026, 5, i + 1)).toISOString(), i / 100));
        json = { ticker: 'AAPL', data, interval, source: 'CONTROLLED AUDIT', price_type: url.searchParams.has('candles') || interval === '1d' ? 'ohlc' : 'snapshot', stale: false };
      } else if (url.pathname.endsWith('/quote')) json = quote;
      else if (url.pathname.includes('/market/')) json = { market: 'US', indices: [], leaders: [], laggards: [], active: [], sectors: [], summary: { mode: 'proxy', breadth_ratio: 50 }, breadth: { advancers: 1, decliners: 1, flat: 0, total: 2 }, updated_at: new Date().toISOString() };
      else if (url.pathname.endsWith('/news')) json = { market: 'ALL', updated_at: new Date().toISOString(), keywords: [], items: [{ title: 'Controlled economy headline', summary: 'Controlled news text', published_at: new Date().toISOString(), source: 'Fixture', market: 'US', url: null }] };
      else if (url.pathname.endsWith('/analyze')) {
        const request = route.request().postDataJSON();
        json = { scope: 'chart', ticker: 'AAPL', period: request.period, interval: request.interval, provider: 'Fixture', model: 'fixture', analyzed_at: new Date().toISOString(), summary: 'Controlled analysis', outlook: '', drivers: [], watch: [], annotations: [], data: [], context: { bar_count: 0, news_count: 0, indicators: {}, news_sources: [], news: [] } };
      } else json = { results: [] };
      await route.fulfill({ json });
    });
    const nav = name => page.locator('.primary-nav').getByRole('button', { name, exact: true });
    const candleChart = interval => page.locator(`.market-chart[data-mode="candles"][data-interval="${interval}"]`);
    await page.clock.install();
    await page.goto('http://127.0.0.1:5173');
    await page.locator('.market-chart').waitFor();
    await page.getByRole('button', { name: 'K线', exact: true }).click();
    const interval = page.getByRole('combobox', { name: 'K线周期', exact: true });
    await interval.selectOption('15m');
    await page.getByRole('button', { name: '五日', exact: true }).click();
    await candleChart('15m').waitFor();
    await interval.dispatchEvent('keydown', { key: '2', code: 'Digit2', bubbles: true });
    assert.equal(new URL(page.url()).searchParams.get('view'), 'overview');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.keyboard.press('2');
    assert.equal(new URL(page.url()).searchParams.get('view'), 'overview');
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await page.reload();
    await candleChart('15m').waitFor();
    assert.equal(await candleChart('15m').getAttribute('data-period'), '5d');
    await page.getByRole('button', { name: 'AI 分析', exact: true }).click();
    await page.locator('.analysis-summary').waitFor();
    await interval.selectOption('30m');
    await candleChart('30m').waitFor();
    await interval.selectOption('15m');
    await candleChart('15m').waitFor();
    assert.equal(await page.locator('.analysis-summary').count(), 0, 'Old analysis must not reappear after a round trip');

    await interval.selectOption('1d');
    await page.getByRole('button', { name: '3月', exact: true }).click();
    await candleChart('1d').waitFor();
    await page.locator('.indicator-legend').filter({ hasText: /MA20 \d/ }).waitFor();
    await page.waitForTimeout(100);
    const formatsBefore = await page.evaluate(() => window.__chartFormats);
    assert(formatsBefore > 0, 'Date-format instrumentation must observe the chart');
    for (let i = 0; i < 5; i++) {
      liveSocket.send(JSON.stringify({ type: 'update', data: { ...quote, price: 200 + i, as_of: `2026-11-03T10:00:0${i}-05:00`, fetched_at: `2026-11-03T15:00:0${i}Z` } }));
      await page.locator('.hero-quote > strong').filter({ hasText: `$${200 + i}.00` }).waitFor();
    }
    const chartFormatsOnQuoteTicks = await page.evaluate(() => window.__chartFormats) - formatsBefore;
    assert.equal(chartFormatsOnQuoteTicks, 0, 'Quote ticks should not recalculate an unchanged historical chart');

    await interval.selectOption('5m');
    await page.getByRole('button', { name: '1日', exact: true }).click();
    await candleChart('5m').waitFor();
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(100);
    const hiddenStart = requests.length;
    await page.clock.runFor(65000);
    await page.waitForTimeout(100);
    const hiddenRequests = requests.length - hiddenStart;
    assert.equal(hiddenRequests, 0);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(100);
    assert(requests.length > hiddenStart, 'Visibility restore must resume requests');
    await nav('情报').click();
    await page.locator('.news-feed > div > button').first().waitFor();
    await page.waitForTimeout(100);
    const newsStart = requests.filter(path => path.includes('/history?') || path.includes('/quote')).length;
    await page.clock.runFor(65000);
    await page.waitForTimeout(100);
    const historyRequestsWhileNews = requests.filter(path => path.includes('/history?') || path.includes('/quote')).length - newsStart;
    assert.equal(historyRequestsWhileNews, 0);
    await page.getByLabel('筛选财经新闻').fill('does-not-exist');
    await page.getByText('没有匹配结果', { exact: true }).waitFor();
    await page.getByRole('button', { name: '清除筛选', exact: true }).click();
    await page.locator('.news-feed > div > button').first().click();
    await page.getByRole('dialog').waitFor();
    await page.keyboard.press('Escape');
    await nav('研究台').click();
    await candleChart('5m').waitFor();
    failHistory = true;
    await page.clock.runFor(31000);
    await page.locator('.chart-heading .quote-tag').filter({ hasText: '缓存' }).waitFor();
    assert.equal(await page.locator('.error-banner').count(), 0, 'Cached history needs only its cache status');
    assert(await candleCount(page) > 0);
    for (const width of [375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const view of ['研究台', '市场', '情报']) {
        await nav(view).click();
        const layout = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
        assert(layout.content <= width + 1);
        layouts.push({ view, ...layout });
      }
    }
    assert.deepEqual(errors, []);
    const report = { checked_at: new Date().toISOString(), scope: 'Controlled browser regression',
      candle_preferences_survive_reload: true, focus_shortcuts_do_not_navigate: true, old_analysis_not_restored: true,
      quote_updates: 5, chart_date_formats_during_quote_updates: chartFormatsOnQuoteTicks,
      requests_during_65s_hidden: hiddenRequests, history_quote_requests_during_65s_news: historyRequestsWhileNews,
      resume_on_visible: true, cached_history_survives_outage_without_banner: true, news_filter_and_dialog: true,
      layouts, javascript_errors: errors };
    fs.writeFileSync('reports/self-audit-browser-check.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
