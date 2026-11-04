const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');

async function fixture(page, state) {
  page.on('pageerror', e => state.errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem('marketdesk:ai-profiles:v1', JSON.stringify({ activeId: 'fixture', profiles: [{ id: 'fixture', name: 'Controlled fixture', baseUrl: 'https://fixture.example/v1', model: 'fixture', protocol: 'chat', updatedAt: 1 }] }));
    sessionStorage.setItem('marketdesk:ai-keys:v1', JSON.stringify({ fixture: 'controlled-test-key' }));
  });
  await page.routeWebSocket('**/ws/stock-updates', socket => { state.sockets++; socket.onMessage(() => {}); });
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url());
    state.requests.push({ path: url.pathname + url.search, time: Date.now() });
    const ticker = url.pathname.split('/')[4] || 'AAPL';
    let json;
    if (url.pathname.endsWith('/history')) {
      if (ticker === 'AAPL' && state.historyGate) await state.historyGate;
      const period = url.searchParams.get('period'), interval = url.searchParams.get('interval');
      const intraday = ['1d', '5d'].includes(period);
      const base = state.generation === 2 ? 200 : ticker === 'NVDA' ? 150 : 100;
      const days = period === '5d' ? [26, 27, 28, 29, 30] : [30];
      const bar = (timestamp, i) => ({ timestamp, open: base + i / 100, high: base + 2 + i / 100, low: base - 1 + i / 100, close: base + 1 + i / 100, volume: 1000 + i });
      const data = intraday ? days.flatMap(day => Array.from({ length: 120 }, (_, i) => {
        const minute = 570 + i;
        return bar(`2026-10-${day}T${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00-04:00`, i);
      })) : Array.from({ length: period === '1y' ? 180 : 40 }, (_, i) => bar(new Date(Date.UTC(2026, 5, 1 + i)).toISOString(), i));
      json = { ticker, data, interval, source: 'CONTROLLED RESILIENCE', price_type: state.invalidCandles ? 'snapshot' : 'ohlc', stale: false };
    } else if (url.pathname.endsWith('/quote')) json = { ticker, price: state.generation === 2 ? 222 : 123, volume: 1000, change_percent: 1, previous_close: 120, open_price: 121, high_price: 230, low_price: 119, source: 'CONTROLLED RESILIENCE', as_of: `2026-11-0${state.generation === 2 ? 3 : 2}T10:00:00-05:00`, fetched_at: `2026-11-0${state.generation === 2 ? 3 : 2}T15:00:00Z` };
    else if (url.pathname.includes('/market/')) json = { market: 'US', indices: [], leaders: [], laggards: [], active: [], sectors: [], summary: { mode: 'proxy', breadth_ratio: 50 }, breadth: { advancers: 1, decliners: 1, flat: 0, total: 2 }, updated_at: new Date().toISOString() };
    else if (url.pathname.endsWith('/news')) json = { market: 'ALL', updated_at: new Date().toISOString(), keywords: [], items: [] };
    else if (url.pathname.endsWith('/analyze')) {
      const request = route.request().postDataJSON();
      const old = Boolean(state.analysisGate);
      if (state.analysisGate) await state.analysisGate;
      json = { scope: 'chart', ticker: request.ticker, period: request.period, interval: request.interval, provider: 'Fixture', model: 'fixture', analyzed_at: new Date().toISOString(), summary: old ? 'Outdated controlled analysis' : 'Fresh controlled analysis', outlook: '', drivers: [], watch: [], annotations: [], data: [], context: { bar_count: 0, news_count: 0, indicators: {}, news_sources: [], news: [] } };
    } else json = { results: [] };
    try { await route.fulfill({ json }); } catch { /* Deliberately canceled old requests can no longer receive a response. */ }
  });
}
const state = () => ({ errors: [], requests: [], sockets: 0, generation: 1 });

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const releases = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await context.newPage(), data = state();
    let releaseHistory;
    data.historyGate = new Promise(resolve => { releaseHistory = resolve; releases.push(resolve); });
    await fixture(page, data);
    await page.clock.install();
    await page.goto('http://127.0.0.1:5173');
    await page.locator('.watch-select').filter({ hasText: 'NVDA' }).click();
    await page.locator('.chart-readout span').filter({ hasText: /^NVDA$/ }).waitFor();
    data.historyGate = null;
    releaseHistory();
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.chart-readout span').textContent(), 'NVDA');
    let releaseAnalysis;
    data.analysisGate = new Promise(resolve => { releaseAnalysis = resolve; releases.push(resolve); });
    await page.getByRole('button', { name: 'AI 分析', exact: true }).click();
    await page.getByRole('button', { name: '分析中…', exact: true }).waitFor();
    await page.getByRole('button', { name: '五日', exact: true }).click();
    data.analysisGate = null;
    releaseAnalysis();
    await page.locator('.market-chart[data-period="5d"]').waitFor();
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.analysis-summary').count(), 0);
    await page.getByRole('button', { name: 'AI 分析', exact: true }).click();
    await page.locator('.analysis-summary').filter({ hasText: 'Fresh controlled analysis' }).waitFor();
    await page.getByRole('button', { name: '清除', exact: true }).click();
    const beforeSilence = data.sockets;
    await page.clock.runFor(46050);
    assert(data.sockets > beforeSilence, 'A silent WebSocket must reconnect even if the server never closes it');
    assert.equal(await page.locator('.market-chart').count(), 1);
    await context.setOffline(true);
    await page.locator('[data-status="disconnected"]').waitFor();
    await page.waitForTimeout(100);
    const offlineStart = data.requests.length;
    await page.clock.runFor(65000);
    await page.waitForTimeout(100);
    const offlineRequests = data.requests.length - offlineStart;
    assert.equal(offlineRequests, 0);
    assert.equal(await page.locator('.market-chart').count(), 1);
    const socketsBefore = data.sockets;
    data.generation = 2;
    const recoveryStart = Date.now();
    await context.setOffline(false);
    await page.locator('.hero-quote > strong').filter({ hasText: '$222.00' }).waitFor({ timeout: 5000 });
    await page.locator('[data-status="connected"]').waitFor({ timeout: 5000 });
    await page.locator('.chart-readout strong').filter({ hasText: /^202\.19/ }).waitFor({ timeout: 5000 });
    assert(data.sockets > socketsBefore);
    const recoveryMs = Date.now() - recoveryStart;
    await page.getByRole('button', { name: 'K线', exact: true }).click();
    const interval = page.getByRole('combobox', { name: 'K线周期', exact: true });
    await page.locator('.market-chart[data-interval="1d"]').waitFor();
    data.invalidCandles = true;
    await interval.selectOption('1m');
    await page.getByRole('status').filter({ hasText: '历史行情暂不可用' }).waitFor();
    assert.equal(await page.locator('.candle').count(), 0);
    data.invalidCandles = false;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.locator('.market-chart[data-mode="candles"][data-interval="1m"]').waitFor();
    const chart = page.locator('.professional-canvas');
    await chart.focus();
    await chart.press('Home');
    assert.equal(await page.locator('.professional-chart').getAttribute('data-active-index'), '0');
    await chart.press('ArrowRight');
    assert.equal(await page.locator('.professional-chart').getAttribute('data-active-index'), '1');
    await chart.press('End');
    assert.equal(await page.locator('.professional-chart').getAttribute('data-active-index'), '119');
    await chart.press('Escape');
    await page.getByRole('button', { name: '折线', exact: true }).click();
    const nativeChart = page.locator('.price-svg');
    await nativeChart.waitFor();
    await nativeChart.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      element.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', clientX: bounds.left + 50, clientY: bounds.top + 50 }));
      element.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse', relatedTarget: document.body }));
    });
    await page.clock.runFor(40);
    assert.equal(await page.locator('.chart-crosshair').count(), 0);
    assert.deepEqual(data.errors, []);
    await context.close();

    const touchResults = [];
    for (const width of [375, 1024]) {
      const touchContext = await browser.newContext({ viewport: { width, height: 1000 }, hasTouch: true, isMobile: true });
      const touchPage = await touchContext.newPage(), touchData = state();
      await fixture(touchPage, touchData);
      await touchPage.goto('http://127.0.0.1:5173');
      const svg = touchPage.locator('.price-svg');
      await svg.waitFor();
      await svg.scrollIntoViewIfNeeded();
      const bounds = await svg.boundingBox();
      const curve = await svg.evaluate(element => {
        const box = element.querySelector('.chart-price-line').getBBox();
        return { left: box.x / element.viewBox.baseVal.width, width: box.width / element.viewBox.baseVal.width };
      });
      const client = await touchContext.newCDPSession(touchPage);
      const finger = (type, x, y) => client.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
      const y = bounds.y + bounds.height * .4;
      const touchX = fraction => bounds.x + bounds.width * (curve.left + curve.width * fraction);
      await finger('touchStart', touchX(.25), y);
      await finger('touchEnd');
      await touchPage.waitForTimeout(80);
      assert.equal(await touchPage.locator('.chart-crosshair').count(), 1);
      const tapped = Number(await svg.getAttribute('data-active-index'));
      assert(tapped < 119);
      await finger('touchStart', touchX(.25), y);
      await finger('touchMove', touchX(.8), y);
      await finger('touchEnd');
      await touchPage.waitForTimeout(80);
      const dragged = Number(await svg.getAttribute('data-active-index'));
      assert(dragged > tapped, JSON.stringify({ width, tapped, dragged, bounds, curve }));
      const scrollStart = await touchPage.evaluate(() => scrollY);
      await finger('touchStart', bounds.x + bounds.width * .5, y);
      await finger('touchMove', bounds.x + bounds.width * .5, y - 30);
      await finger('touchMove', bounds.x + bounds.width * .5, y - 150);
      await finger('touchEnd');
      await touchPage.waitForTimeout(200);
      const scrolled = await touchPage.evaluate(() => scrollY) - scrollStart;
      assert(scrolled > 10, 'Vertical scrolling over the chart must remain available');
      assert.equal(await touchPage.locator('.chart-crosshair').count(), 0);
      await touchPage.getByRole('button', { name: /^指标/ }).click();
      await touchPage.getByRole('checkbox', { name: 'RSI(14)', exact: true }).check();
      await touchPage.getByRole('button', { name: /^指标/ }).click();
      const panel = touchPage.locator('[data-indicator="rsi"] svg');
      await panel.scrollIntoViewIfNeeded();
      const panelBounds = await panel.boundingBox();
      await finger('touchStart', panelBounds.x + panelBounds.width * (curve.left + curve.width * .35), panelBounds.y + 40);
      await finger('touchEnd');
      await touchPage.waitForTimeout(80);
      assert.equal(await touchPage.locator('.chart-crosshair').count(), 1);
      assert(Number(await svg.getAttribute('data-active-index')) < 119);
      await touchPage.screenshot({ path: `.local/resilience-touch-${width}.png`, fullPage: true });
      assert.deepEqual(touchData.errors, []);
      touchResults.push({ width, tapped_index: tapped, dragged_index: dragged, vertical_scroll_pixels: scrolled, linked_panel_touch: true });
      await touchContext.close();
    }
    const report = { checked_at: new Date().toISOString(), scope: 'Controlled network, race and real Chromium touch input',
      old_stock_response_ignored: true, old_analysis_response_ignored: true, requests_during_65s_offline: offlineRequests,
      online_recovery_ms: recoveryMs, websocket_reconnected_without_backoff: true, snapshot_rejected_for_candles: true,
      chart_keyboard_navigation: true, no_crosshair_after_mouse_leave_race: true, touch: touchResults, javascript_errors: [] };
    fs.writeFileSync('reports/resilience-browser-check.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { for (const release of releases) release(); await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
