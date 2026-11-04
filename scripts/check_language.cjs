// Real UI with the isolated model/API fixture on localhost:8002.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors = [], requests = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/v1/ai/**', async route => {
      const request = route.request();
      requests.push(JSON.parse(request.postData()));
      const response = await route.fetch({ url: 'http://127.0.0.1:8002' + new URL(request.url()).pathname });
      await route.fulfill({ response });
    });
    await page.route('**/api/v1/stocks/*/history?*', async route => {
      const url = new URL(route.request().url());
      const response = await route.fetch({ url: 'http://127.0.0.1:8002' + url.pathname + url.search });
      await route.fulfill({ response });
    });
    await page.goto('http://127.0.0.1:5173');
    await page.locator('.price-svg').waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('tab', { name: '语言', exact: true }).click();
    await page.getByRole('button', { name: 'English', exact: true }).click();
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
    await dialog.waitFor();
    await page.getByRole('tab', { name: 'AI settings', exact: true }).click();
    await page.getByRole('button', { name: 'Add provider', exact: true }).click();
    await page.getByLabel('Provider name').fill('Language fixture');
    await page.getByLabel('API endpoint').fill('http://127.0.0.1:8769/v1');
    await page.getByLabel('Model', { exact: true }).fill('test-chat');
    await page.getByLabel('API Key', { exact: true }).fill('fixture-secret-key');
    await page.getByRole('button', { name: 'Save and use', exact: true }).click();
    await page.getByRole('button', { name: 'Language fixture', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Close settings' }).click();
    assert.equal(await page.locator('.primary-nav').innerText(), 'Workspace\nMarkets\nNews');
    assert.equal(await page.locator('.chart-context').innerText().then(s => /[\u4e00-\u9fff]/.test(s)), false);
    assert.equal(await page.locator('.chart-readout').innerText().then(s => /[\u4e00-\u9fff]/.test(s)), false);
    await page.getByRole('button', { name: /^Indicators/ }).click();
    await page.getByRole('checkbox', { name: 'Volume', exact: true }).waitFor();
    assert.equal(await page.getByRole('group', { name: 'Indicator selection' }).getByRole('checkbox').count(), 15);
    await page.getByRole('button', { name: /^Indicators/ }).click();
    await page.getByRole('button', { name: 'AI analysis', exact: true }).click();
    await page.getByRole('region', { name: 'AI analysis results' }).waitFor({ timeout: 20000 });
    assert.match(await page.locator('.analysis-summary').innerText(), /Controlled fixture/);
    assert.equal(requests.at(-1).language, 'en');
    assert.equal(await page.locator('.chart-annotation').count(), 2);
    assert.equal(await page.locator('.annotation-label').first().textContent(), 'Support');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'Language', exact: true }).click();
    await page.getByRole('button', { name: '中文', exact: true }).click();
    await page.getByRole('button', { name: '关闭设置' }).click();
    assert.equal(await page.locator('.analysis-summary').count(), 0);
    await page.getByRole('button', { name: 'AI 分析', exact: true }).click();
    await page.getByRole('region', { name: 'AI 分析结果' }).waitFor({ timeout: 20000 });
    assert.equal(requests.at(-1).language, 'zh');
    assert.match(await page.locator('.analysis-summary').innerText(), /受控测试/);
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('tab', { name: '语言', exact: true }).click();
    await page.getByRole('button', { name: 'English', exact: true }).click();
    await page.getByRole('button', { name: 'Close settings' }).click();
    await page.reload();
    await page.locator('.price-svg').waitFor({ timeout: 30000 });
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    const layouts = [];
    for (const width of [375, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const view of ['Workspace', 'Markets', 'News']) {
        await page.locator('.primary-nav').getByRole('button', { name: view, exact: true }).click();
        const size = await page.evaluate(() => ({ viewport: innerWidth, page: document.documentElement.scrollWidth }));
        assert(size.page <= size.viewport + 1, `${view}: ${JSON.stringify(size)}`);
        layouts.push({ view, ...size });
      }
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      const bounds = await page.locator('.settings-dialog').boundingBox();
      assert(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
      const overflow = await page.locator('.settings-dialog').evaluate(el => el.scrollWidth > el.clientWidth + 1);
      assert(!overflow, `Settings overflow at ${width}`);
      await page.screenshot({ path: `.local/language-settings-${width}.png` });
      await page.getByRole('button', { name: 'Close settings' }).click();
    }
    // Same-origin tabs pick up language changes without a refresh.
    const second = await context.newPage();
    await second.goto('http://127.0.0.1:5173');
    await second.getByRole('button', { name: 'Settings', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'Language', exact: true }).click();
    await page.getByRole('button', { name: '中文', exact: true }).click();
    await second.getByRole('button', { name: '设置', exact: true }).waitFor();
    assert.equal(await second.locator('html').getAttribute('lang'), 'zh-CN');
    assert.deepEqual(errors, []);
    const report = { checked_at: new Date().toISOString(), immediate_switch: true, saved_across_reload: true,
      synchronized_tabs: true, chart_readout_localized: true, indicators: 15, analysis_request_languages: ['en', 'zh'],
      controlled_model_output_languages: ['en', 'zh'], layouts, javascript_errors: errors };
    fs.writeFileSync('reports/language-browser-check.json', JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
