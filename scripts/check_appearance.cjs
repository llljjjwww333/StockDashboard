const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { readyCandles } = require('./chart_assertions.cjs');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.PREVIEW_URL || 'http://127.0.0.1:5173');
    await page.locator('.price-svg').waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: 'K线', exact: true }).click();
    await page.getByRole('button', { name: /^指标/ }).click();
    await page.getByRole('checkbox', { name: 'MACD(12,26,9)', exact: true }).check();
    await page.getByRole('button', { name: /^指标/ }).click();
    await page.locator(`${readyCandles}[data-pane-count="3"]`).waitFor({ timeout: 30000 });
    const results = [];
    for (const theme of ['dark', 'light']) {
      for (const colors of ['green-up', 'red-up']) {
        await page.getByRole('button', { name: '设置', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: '设置', exact: true });
        await dialog.getByRole('tab', { name: '个性化', exact: true }).click();
        await dialog.getByRole('button', { name: theme === 'dark' ? '深色' : '浅色', exact: true }).click();
        await dialog.getByRole('button', { name: colors === 'green-up' ? '绿涨红跌' : '红涨绿跌', exact: true }).click();
        assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
        assert.equal(await page.locator('html').getAttribute('data-price-colors'), colors);
        await dialog.getByRole('button', { name: '关闭设置', exact: true }).click();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const computed = await page.evaluate(() => {
          const css = getComputedStyle(document.documentElement);
          const resolve = value => { const probe = document.createElement('i'); probe.style.color = value; document.body.append(probe); const color = getComputedStyle(probe).color; probe.remove(); return color; };
          const up = resolve('var(--up)'), down = resolve('var(--down)');
          const colors = [up, down].map(color => color.match(/\d+/g).slice(0, 3).map(Number));
          const pixels = [0, 0];
          for (const canvas of document.querySelectorAll('.professional-canvas canvas')) {
            if (canvas.width < 100 || !canvas.height) continue;
            const buffer = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
            for (let i = 0; i < buffer.length; i += 4) {
              if (buffer[i + 3] < 250) continue;
              for (let side = 0; side < colors.length; side++) {
                const [red, green, blue] = colors[side];
                if (buffer[i] === red && buffer[i + 1] === green && buffer[i + 2] === blue) pixels[side]++;
              }
            }
          }
          return {
            background: getComputedStyle(document.body).backgroundColor,
            scheme: css.colorScheme,
            up, down, pixels,
            green: resolve('var(--green)'), red: resolve('var(--red)'),
            positive: [...document.querySelectorAll('.positive')].every(el => getComputedStyle(el).color === resolve('var(--up)')),
            negative: [...document.querySelectorAll('.negative')].every(el => getComputedStyle(el).color === resolve('var(--down)')),
          };
        });
        assert.equal(computed.scheme, theme);
        assert.equal(computed.up, colors === 'red-up' ? computed.red : computed.green);
        assert.equal(computed.down, colors === 'red-up' ? computed.green : computed.red);
        assert(computed.pixels.every(count => count > 10), 'Both price colors must be present on the rendered chart');
        assert(computed.positive && computed.negative);
        results.push({ theme, colors, ...computed });
        await page.screenshot({ path: `.local/appearance-${theme}-${colors}.png`, fullPage: true });
      }
    }
    assert.notEqual(results[0].background, results[2].background);
    await page.reload();
    await page.locator(readyCandles).waitFor({ timeout: 30000 });
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    assert.equal(await page.locator('html').getAttribute('data-price-colors'), 'red-up');
    const layouts = [];
    for (const width of [375, 1024]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.getByRole('button', { name: '设置', exact: true }).click();
      const bounds = await page.locator('.settings-dialog').boundingBox();
      const size = await page.evaluate(() => ({ viewport: innerWidth, page: document.documentElement.scrollWidth }));
      assert(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
      assert(size.page <= size.viewport + 1);
      layouts.push({ width, bounds, ...size });
      await page.screenshot({ path: `.local/appearance-settings-${width}.png` });
      await page.getByRole('button', { name: '关闭设置', exact: true }).click();
    }
    assert.deepEqual(errors, []);
    const report = { checked_at: new Date().toISOString(), combinations: results, saved_across_reload: true, layouts, javascript_errors: errors };
    fs.writeFileSync('reports/appearance-browser-check.json', JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
