const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs'), assert = require('node:assert/strict');
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:5176';

function stats(values) {
  const ordered = [...values].sort((a, b) => a - b);
  if (!ordered.length) return { count: 0 };
  return { count: ordered.length, p50: +ordered[Math.floor(ordered.length * .5)].toFixed(1),
    p95: +ordered[Math.floor(ordered.length * .95)].toFixed(1), max: +ordered.at(-1).toFixed(1),
    gapsOver500ms: ordered.filter(n => n > 500).length };
}
const differences = values => values.slice(1).map((value, index) => value - values[index]);

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.addInitScript(() => {
      const Original = window.WebSocket;
      window.WebSocket = class extends Original {
        constructor(...args) {
          super(...args);
          if (!String(args[0]).includes('/stock-updates')) return;
          window.bookTestSocket = this;
          this.addEventListener('message', event => {
            try {
              const message = JSON.parse(event.data);
              if (message.type !== 'depth') return;
              if (window.holdNativeDepth && !event.bookFixture) { event.stopImmediatePropagation(); return; }
              window.lastBookEvent = message;
              (window.bookWireTimes ||= []).push(performance.now());
            } catch {}
          });
        }
      };
    });
    await page.goto(base + '/?view=overview&market=CRYPTO&ticker=BTCUSDT&period=1d&chart=candles&interval=1m', { timeout: 90000 });
    await page.waitForFunction(() => document.querySelector('.order-book')?.dataset.depthSequence, null, { timeout: 90000 });
    await page.waitForTimeout(3000);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.evaluate(() => {
      window.bookPaintTimes = []; window.bookWireTimes = [];
      new MutationObserver(records => {
        if (records.some(record => record.attributeName === 'data-depth-sequence')) window.bookPaintTimes.push(performance.now());
      }).observe(document.querySelector('.order-book'), { attributes: true, attributeFilter: ['data-depth-sequence'] });
    });
    await page.waitForTimeout(20000);
    const real = await page.evaluate(() => ({ wire: window.bookWireTimes, paint: window.bookPaintTimes }));
    assert(real.paint.length > 40, 'Too few native book snapshots reached the screen');
    // A controlled burst verifies latest-frame semantics independently of internet jitter.
    const target = await page.evaluate(() => {
      window.holdNativeDepth = true;
      const source = window.lastBookEvent, first = source.data.sequence;
      window.emitBookFixture = n => {
        const message = structuredClone(source);
        message.data.sequence = first + n;
        message.data.received_at = '2020-01-01T00:00:00Z';
        message.data.book.bids[0].volume = n / 100000;
        const event = new MessageEvent('message', { data: JSON.stringify(message) });
        event.bookFixture = true;
        window.bookTestSocket.dispatchEvent(event);
      };
      window.burstCommits = [];
      new MutationObserver(() => window.burstCommits.push(document.querySelector('.order-book').dataset.depthSequence))
        .observe(document.querySelector('.order-book'), { attributes: true, attributeFilter: ['data-depth-sequence'] });
      for (let n = 1; n <= 200; n++) window.emitBookFixture(n);
      return first + 200;
    });
    await page.waitForFunction(target => document.querySelector('.order-book').dataset.depthSequence === String(target), target);
    const commits = await page.evaluate(() => window.burstCommits);
    assert.deepEqual(commits, [String(target)], 'A burst must paint only the newest snapshot');
    const quantity = await page.locator('.book-side.bid .book-row small').first().innerText();
    assert.equal(Number(quantity.replaceAll(',', '')), .002);
    let depthPolls = 0;
    const countPoll = request => { if (/\/stocks\/BTCUSDT\/depth(?:\?|$)/.test(request.url())) depthPolls++; };
    page.on('request', countPoll);
    await page.evaluate(() => {
      window.fixtureCount = 200;
      window.fixtureTimer = setInterval(() => window.emitBookFixture(++window.fixtureCount), 100);
    });
    await page.waitForTimeout(6500);
    const clockCheck = await page.evaluate(() => {
      clearInterval(window.fixtureTimer);
      return { sequence: document.querySelector('.order-book').dataset.depthSequence,
        time: document.querySelector('.book-meta time').dateTime };
    });
    assert(Number(clockCheck.sequence) > target, 'Book stopped updating during the clock-skew check');
    assert.equal(clockCheck.time, '2020-01-01T00:00:00Z');
    assert.equal(depthPolls, 0, 'Device/server clock difference must not replace a fresh stream with REST');
    assert.equal(await page.locator('.book-row').count(), 20);
    assert.deepEqual(errors, []);
    const report = { url: base, cpuThrottle: 4, realSeconds: 20,
      transportIntervals: stats(differences(real.wire)), paintIntervals: stats(differences(real.paint)),
      burstMessages: 200, burstPaints: commits.length, newestQuantityExact: true,
      clockSkewHandled: true, unexpectedDepthPolls: depthPolls, rows: 20, errors };
    fs.writeFileSync(process.env.REPORT_PATH || 'reports/order-book-cadence-check.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally { await context.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
