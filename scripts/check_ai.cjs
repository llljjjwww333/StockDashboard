// Uses an isolated fake provider and deterministic market data on localhost:8002.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/v1/stocks/*/history?*', async route => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: 'http://127.0.0.1:8002' + url.pathname + url.search });
    await route.fulfill({ response });
  });
  await page.route('**/api/v1/ai/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const response = await route.fetch({ url: 'http://127.0.0.1:8002' + path, timeout: 90000 });
    await route.fulfill({ response });
  });
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('button', { name: '1月', exact: true }).click();
  await page.locator('.market-chart svg').waitFor({ timeout: 25000 });
  const settings = async () => {
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('dialog', { name: '设置', exact: true }).waitFor();
  };
  const close = () => page.getByRole('button', { name: '关闭设置' }).click();
  await settings();
  await page.getByRole('button', { name: '添加接口', exact: true }).click();
  await page.getByLabel('接口名称').fill('测试接口 A');
  await page.getByLabel('接口地址').fill('http://127.0.0.1:8769/v1');
  await page.getByLabel('模型', { exact: true }).fill('test-chat');
  await page.getByLabel('API Key', { exact: true }).fill('fixture-secret-key');
  await page.getByRole('button', { name: '测试连接', exact: true }).click();
  await page.getByText('连接成功', { exact: true }).waitFor();
  await page.getByRole('button', { name: '保存并使用' }).click();
  assert(!(await page.evaluate(() => localStorage.getItem('marketdesk:ai-profiles:v1'))).includes('fixture-secret-key'));
  await close();
  await page.getByRole('button', { name: 'AI 分析', exact: true }).click();
  await page.getByRole('region', { name: 'AI 分析结果' }).waitFor({ timeout: 20000 });
  assert.equal(await page.locator('.chart-annotation').count(), 2);
  assert.equal(await page.getByText('INVALID', { exact: true }).count(), 0);
  await page.locator('.analysis-points button').first().click();
  await page.locator('.annotation-detail').waitFor();
  await page.screenshot({ path: '.local/ai-chart-test.png', fullPage: true });
  await page.getByRole('button', { name: '分时', exact: true }).click();
  assert.equal(await page.locator('.chart-annotation').count(), 0);
  assert.equal(await page.locator('.analysis-summary').count(), 0);
  await page.getByRole('button', { name: 'AI 分析', exact: true }).click();
  await page.locator('.analysis-summary').waitFor();
  await settings();
  await page.getByRole('button', { name: '添加接口', exact: true }).click();
  await page.getByLabel('接口名称').fill('测试接口 B');
  await page.getByLabel('接口协议').selectOption('anthropic');
  await page.getByLabel('接口地址').fill('http://127.0.0.1:8769/v1');
  await page.getByLabel('模型', { exact: true }).fill('test-messages');
  await page.getByLabel('API Key', { exact: true }).fill('fixture-secret-key');
  await page.getByRole('checkbox', { name: '在此设备记住密钥' }).check();
  await page.getByRole('button', { name: '保存并使用' }).click();
  assert((await page.evaluate(() => localStorage.getItem('marketdesk:ai-profiles:v1'))).includes('fixture-secret-key'));
  await close();
  assert.equal(await page.locator('.analysis-summary').count(), 0);
  const select = page.getByLabel('分析接口', { exact: true });
  const profiles = await page.evaluate(() => JSON.parse(localStorage.getItem('marketdesk:ai-profiles:v1')).profiles.map(p => ({ id: p.id, name: p.name })));
  await select.selectOption(profiles.find(p => p.name === '测试接口 A').id);
  await select.selectOption(profiles.find(p => p.name === '测试接口 B').id);
  await page.getByRole('button', { name: 'AI 分析', exact: true }).click();
  await page.locator('.analysis-summary').waitFor();
  assert.equal(await page.locator('.chart-annotation').count(), 2);
  await page.locator('.primary-nav button').filter({ hasText: '情报' }).click();
  await page.getByRole('button', { name: 'AI 分析', exact: true }).click();
  await page.locator('.news-page .analysis-summary').waitFor();
  await page.screenshot({ path: '.local/ai-news-test.png', fullPage: true });
  for (const width of [375, 1024]) {
    await page.setViewportSize({ width, height: 1000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await settings();
    assert(await page.evaluate(() => document.querySelector('.settings-dialog').getBoundingClientRect().width <= innerWidth));
    await page.screenshot({ path: `.local/ai-settings-${width}-test.png`, fullPage: false });
    await close();
  }
  await settings();
  await page.getByRole('button', { name: '测试接口 B', exact: true }).click();
  await page.getByLabel('API Key', { exact: true }).fill('bad-fixture');
  await page.getByLabel('模型', { exact: true }).fill('test-messages');
  await page.getByRole('button', { name: '保存并使用' }).click();
  await close();
  await page.getByRole('button', { name: 'AI 分析', exact: true }).click();
  await page.getByText('API Key 无效', { exact: true }).waitFor();
  const calls = await (await page.request.get('http://127.0.0.1:8002/test-calls')).json();
  assert(calls.some(c => c.scope === 'chart' && c.period === '1d' && c.interval === '1m' && c.bar_count === 40));
  assert(calls.some(c => c.scope === 'chart' && c.period === '1mo' && c.bar_count === 80));
  assert(calls.some(c => c.protocol === 'anthropic' && c.scope === 'news' && c.news_count === 2));
  assert.equal(errors.length, 0, errors.join('\n'));
  const report = { checked_at: new Date().toISOString(), scope: 'Controlled provider and data, no real API keys or model efficacy claims',
    provider_test: true, profile_switch: true, chart_annotations: true, invalid_annotations_rejected: true,
    period_invalidation: true, news_analysis: true, key_persistence_opt_in: true, provider_error: true,
    viewport_widths: [375, 1024, 1440], javascript_errors: errors, calls };
  fs.writeFileSync('reports/ai-browser-check.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
