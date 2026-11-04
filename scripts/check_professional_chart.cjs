const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const history = (ticker, period) => {
  const base = ticker === '510300' ? 4.092 : 130;
  const count = ['1d', '5d'].includes(period) ? period === '5d' ? 600 : 120 : period === '1y' ? 260 : 80;
  return Array.from({ length: count }, (_, i) => {
    const close = base + Math.sin(i / 9) * base * .018 + i / count * base * .04;
    const timestamp = ['1d', '5d'].includes(period) ? new Date(Date.UTC(2026, 9, 26 + Math.floor(i / 120), 13, 30 + i % 120)).toISOString()
      : new Date(Date.UTC(2026, 0, 1 + i)).toISOString();
    return { timestamp, open: close - base * .002, high: close + base * .005, low: close - base * .004, close, volume: 1000 + i * 37 };
  });
};
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, hasTouch: true });
    const errors = [], layouts = [];
    let liveUpdate = false;
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      localStorage.setItem('marketdesk:ai-profiles:v1', JSON.stringify({ activeId: 'fixture', profiles: [{ id: 'fixture', name: 'Controlled fixture', baseUrl: 'https://fixture.example/v1', model: 'fixture', protocol: 'chat', updatedAt: 1 }] }));
      sessionStorage.setItem('marketdesk:ai-keys:v1', JSON.stringify({ fixture: 'controlled-key' }));
    });
    await page.routeWebSocket('**/ws/stock-updates', socket => socket.onMessage(raw => {
      if (JSON.parse(raw).type === 'ping') socket.send('{"type":"pong"}');
    }));
    await page.route('**/api/v1/**', async route => {
      const url = new URL(route.request().url()), ticker = url.pathname.split('/')[4] || 'AAPL';
      let json;
      if (url.pathname.endsWith('/history')) {
        const points = history(ticker, url.searchParams.get('period'));
        if (liveUpdate && ticker === 'AAPL' && url.searchParams.get('period') === '1mo') {
          points[points.length - 1].close += .1;
          points.push({ ...points[points.length - 1], timestamp: new Date(Date.parse(points[points.length - 1].timestamp) + 86400000).toISOString() });
        }
        json = { ticker, data: points, interval: url.searchParams.get('interval'), source: 'CONTROLLED PRO CHART', price_type: 'ohlc', adjustment: 'qfq' };
      }
      else if (url.pathname.endsWith('/quote')) json = { ticker, price: ticker === '510300' ? 4.092 : 140, change_percent: 1, volume: 100000, previous_close: ticker === '510300' ? 4.081 : 138,
        open_price: ticker === '510300' ? 4.088 : 139, high_price: ticker === '510300' ? 4.101 : 141, low_price: ticker === '510300' ? 4.079 : 137, as_of: '2026-11-03T15:00:00+08:00', fetched_at: new Date().toISOString(),
        order_book: /^\d/.test(ticker) ? { bids: [1, 2, 3, 4, 5].map(level => ({ level, price: 4.092 - level * .001, volume: level * 1000 })), asks: [1, 2, 3, 4, 5].map(level => ({ level, price: 4.091 + level * .001, volume: level * 2000 })) } : null };
      else if (url.pathname.includes('/market/')) json = { market: 'US', indices: [], sectors: [], leaders: [], laggards: [], active: [], breadth: { total: 2, advancers: 1, decliners: 1, flat: 0 }, summary: { mode: 'proxy', breadth_ratio: 50 }, updated_at: new Date().toISOString() };
      else if (url.pathname.endsWith('/news')) json = { market: 'ALL', updated_at: new Date().toISOString(), keywords: [], items: [] };
      else if (url.pathname.endsWith('/search')) {
        assert.equal(url.searchParams.get('market'), 'CN');
        json = { results: [{ ticker: '510300', name: '沪深300ETF' }] };
      }
      else if (url.pathname.endsWith('/analyze')) {
        const request = route.request().postDataJSON(), data = history(request.ticker, request.period);
        json = { scope: 'chart', ticker: request.ticker, period: request.period, interval: request.interval, provider: 'Fixture', model: 'fixture', analyzed_at: new Date().toISOString(),
          summary: 'Controlled grounded analysis', outlook: '', drivers: [], watch: [], data, context: { bar_count: data.length, news_count: 0, indicators: {}, news_sources: [], news: [] },
          annotations: [{ id: 'support', index: 10, timestamp: data[10].timestamp, price: data[10].low, kind: 'support', label: '支撑', detail: 'Controlled support' },
            { id: 'resistance', index: 50, timestamp: data[50].timestamp, price: data[50].high, kind: 'resistance', label: '阻力', detail: 'Controlled resistance' }],
          trendlines: [{ id: 'trend-support', kind: 'support', label: '支撑趋势线', detail: 'Controlled rising lows',
            start: { timestamp: data[10].timestamp, price: data[10].low }, end: { timestamp: data[64].timestamp, price: data[64].low } },
          { id: 'trend-resistance', kind: 'resistance', label: '阻力趋势线', detail: 'Controlled highs',
            start: { timestamp: data[20].timestamp, price: data[20].high }, end: { timestamp: data[50].timestamp, price: data[50].high } }] };
      } else json = { results: [] };
      await route.fulfill({ json });
    });
    await page.clock.install();
    await page.goto(process.env.PREVIEW_URL || 'http://127.0.0.1:5173');
    await page.locator('.price-svg').waitFor();
    await page.getByRole('button', { name: 'K线', exact: true }).click();
    const chart = page.locator('.professional-chart');
    await chart.locator('canvas').first().waitFor();
    await page.waitForFunction(() => document.querySelector('.professional-chart')?.getAttribute('data-visible-from') !== null);
    assert.equal(await chart.getAttribute('data-candle-count'), '80');
    assert.equal(await chart.getAttribute('data-pane-count'), '2');
    assert(await chart.locator('a[href*="tradingview.com"]').count() > 0, 'Attribution must remain visible');
    const range = async () => ({ from: Number(await chart.getAttribute('data-visible-from')), to: Number(await chart.getAttribute('data-visible-to')) });
    const initial = await range();
    const canvas = page.locator('.professional-canvas');
    const bounds = await canvas.boundingBox();
    await page.mouse.move(bounds.x + bounds.width * .5, bounds.y + 120);
    await page.mouse.wheel(0, -450);
    await page.waitForTimeout(200);
    const zoomed = await range();
    assert(zoomed.to - zoomed.from < initial.to - initial.from);
    await page.mouse.move(bounds.x + bounds.width * .6, bounds.y + 100);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width * .85, bounds.y + 100, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const panned = await range();
    assert(Math.abs(panned.from - zoomed.from) > 1);
    liveUpdate = true;
    await page.clock.runFor(61000);
    await page.waitForFunction(() => document.querySelector('.professional-chart')?.getAttribute('data-candle-count') === '81');
    const afterRefresh = await range();
    assert(Math.abs(afterRefresh.from - panned.from) < .05 && Math.abs(afterRefresh.to - panned.to) < .05, 'Historical browsing camera must survive tail update and append');
    await page.getByRole('combobox', { name: '价格刻度', exact: true }).selectOption('log');
    assert.equal(await chart.getAttribute('data-price-scale'), 'log');
    await page.getByRole('combobox', { name: '价格刻度', exact: true }).selectOption('percent');
    assert.equal(await chart.getAttribute('data-price-scale'), 'percent');
    await page.getByRole('combobox', { name: '价格刻度', exact: true }).selectOption('normal');
    await page.getByRole('button', { name: '重置视图', exact: true }).click();
    await page.getByRole('button', { name: '水平线', exact: true }).click();
    await page.mouse.click(bounds.x + bounds.width * .45, bounds.y + 120);
    await page.waitForFunction(() => document.querySelector('.professional-chart')?.getAttribute('data-level-count') === '1');
    await page.getByRole('button', { name: '全屏图表', exact: true }).click();
    assert.equal(await page.locator('.professional-chart.is-expanded').count(), 1);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.professional-chart.is-expanded').count(), 0);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '保存图表', exact: true }).click();
    await (await download).saveAs('.local/pro-chart-export.png');
    assert(fs.statSync('.local/pro-chart-export.png').size > 5000);
    await page.getByRole('button', { name: 'AI 分析', exact: true }).click();
    await page.locator('.analysis-summary').waitFor();
    assert.equal(await chart.getAttribute('data-annotation-count'), '2');
    await page.locator('.analysis-points button').first().click();
    await page.waitForFunction(() => document.querySelector('.professional-chart')?.getAttribute('data-active-index') === '10');
    assert((await chart.locator('.annotation-detail').textContent()).includes('Controlled support'));
    assert.equal(await chart.getAttribute('data-trend-count'), '2');
    await page.getByRole('button', { name: /^支撑趋势线/ }).click();
    await page.waitForFunction(() => document.querySelector('.professional-chart')?.getAttribute('data-active-index') === '64');
    assert((await chart.locator('.annotation-detail').textContent()).includes('Controlled rising lows'));
    const normalWidth = (await canvas.boundingBox()).width;
    const beforeFocus = await range();
    await page.getByRole('button', { name: '沉浸看盘', exact: true }).click();
    await page.waitForFunction(width => {
      const canvas = document.querySelector('.professional-canvas');
      const expandedWidth = canvas.getBoundingClientRect().width;
      return expandedWidth > width + 200 && Math.abs(canvas.querySelector('table').getBoundingClientRect().width - expandedWidth) < 2;
    }, normalWidth);
    const inFocus = await range();
    assert(Math.abs(inFocus.from - beforeFocus.from) < 1 && Math.abs(inFocus.to - beforeFocus.to) < 1, 'Entering focus mode must preserve the visible bars');
    assert.equal(await page.locator('.sidebar').isVisible(), false);
    assert.equal(await chart.getAttribute('data-trend-count'), '2');
    await page.screenshot({ path: '.local/pc-focus-ai.png' });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.sidebar').isVisible(), true);
    await page.keyboard.press('f');
    await page.getByRole('button', { name: '退出沉浸', exact: true }).waitFor();
    await page.getByRole('button', { name: '折线', exact: true }).click();
    await page.getByRole('button', { name: 'AI 分析', exact: true }).click();
    const trend = page.locator('.chart-trendline.support');
    await trend.waitFor();
    assert.equal(await page.locator('.chart-trendline').count(), 2);
    await trend.focus();
    await page.keyboard.press('Enter');
    await page.locator('.annotation-detail').filter({ hasText: 'Controlled rising lows' }).waitFor();
    await page.getByRole('button', { name: '清除', exact: true }).click();
    assert.equal(await page.locator('.chart-trendline').count(), 0);
    await page.getByRole('button', { name: '退出沉浸', exact: true }).click();
    await page.getByRole('button', { name: 'K线', exact: true }).click();
    await chart.locator('canvas').first().waitFor();
    await page.screenshot({ path: '.local/pro-chart-annotations.png', fullPage: true });
    await page.getByRole('button', { name: /^指标/ }).click();
    for (const checkbox of await page.getByRole('group', { name: '指标选择' }).getByRole('checkbox').all()) await checkbox.check();
    await page.getByRole('button', { name: /^指标/ }).click();
    assert.equal(await chart.getAttribute('data-pane-count'), '9');
    assert.equal(await chart.getAttribute('data-overlay-count'), '9');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('tab', { name: '个性化', exact: true }).click();
    await page.getByRole('button', { name: '浅色', exact: true }).click();
    await page.getByRole('button', { name: '红涨绿跌', exact: true }).click();
    await page.getByRole('tab', { name: '语言', exact: true }).click();
    await page.getByRole('button', { name: 'English', exact: true }).click();
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
    await page.getByRole('combobox', { name: 'Price scale', exact: true }).waitFor();
    for (const width of [320, 375, 390, 430, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const layout = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth,
        canvas: document.querySelector('.professional-canvas').getBoundingClientRect().width }));
      assert(layout.content <= width + 1);
      assert(layout.canvas <= width);
      const tools = await page.locator('.professional-tools').evaluate(node => {
        const box = node.getBoundingClientRect();
        const plot = document.querySelector('.professional-canvas').getBoundingClientRect();
        return box.bottom <= plot.top + 1 && [...node.querySelectorAll('button, select')].every(control => {
          const rect = control.getBoundingClientRect();
          return rect.top >= box.top && rect.bottom <= box.bottom + 1 && rect.left >= box.left && rect.right <= box.right + 1;
        });
      });
      assert(tools, 'Chart tool icons must stay inside the toolbar');
      layouts.push(layout);
      await page.screenshot({ path: `.local/pro-chart-${width}.png`, fullPage: true });
    }
    await page.reload();
    await chart.locator('canvas').first().waitFor();
    assert.equal(await chart.getAttribute('data-level-count'), '1');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.market-context').getByRole('button', { name: 'China', exact: true }).tap();
    await page.locator('.watch-item.active').filter({ hasText: '600519' }).waitFor();
    const search = page.getByRole('combobox', { name: 'Search stocks', exact: true });
    await search.fill('510300');
    const result = page.getByRole('option').filter({ hasText: '510300' }).first();
    await result.waitFor();
    const resultsBox = await page.getByRole('listbox').boundingBox();
    assert(resultsBox.x >= 0 && resultsBox.x + resultsBox.width <= 390);
    await result.tap();
    await page.locator('.hero-quote > strong').filter({ hasText: '¥4.092' }).waitFor();
    await page.getByRole('region', { name: 'Order book', exact: true }).waitFor().catch(() => {});
    await page.locator('.order-book .book-row').first().waitFor();
    assert.equal(await page.locator('.book-row').count(), 10);
    assert((await page.locator('.order-book').textContent()).includes('4.091'));
    assert((await page.locator('.key-stats').textContent()).includes('4.081'));
    assert.equal(await search.evaluate(node => node === document.activeElement), false);
    assert.equal(await page.getByRole('listbox').count(), 0);
    assert(await page.locator('.watch-items').evaluate(node => {
      const bounds = node.getBoundingClientRect(), card = node.querySelector('.watch-item.active').getBoundingClientRect();
      return card.left >= bounds.left - 1 && card.right <= bounds.right + 1;
    }));
    assert.deepEqual(errors, []);
    const report = { checked_at: new Date().toISOString(), engine: 'TradingView Lightweight Charts 5.2.1',
      zoom: true, pan: true, camera_preserved_on_live_tail_and_append: true, price_scales: ['normal', 'log', 'percent'], horizontal_lines_persist: true,
      fullscreen_escape: true, screenshot_bytes: fs.statSync('.local/pro-chart-export.png').size,
      grounded_ai_markers: 2, grounded_trendlines_in_both_charts: 2, focus_mode: true, linked_panes: 9, main_overlay_lines: 9, themes_and_language: true,
      etf_three_decimal_quote: true, five_levels_each_side: true, layouts, javascript_errors: errors };
    fs.writeFileSync('reports/professional-chart-browser-check.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
