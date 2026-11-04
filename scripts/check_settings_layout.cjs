const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [], layouts = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.PREVIEW_URL || 'http://127.0.0.1:5173');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('tabpanel', { name: 'AI 配置', exact: true }).waitFor();
    assert.equal(await page.locator('.provider-form').count(), 0);
    await page.getByRole('button', { name: '添加接口', exact: true }).click();
    await page.getByLabel('接口名称').fill('Cancelled draft');
    await page.getByRole('button', { name: '返回接口列表', exact: true }).click();
    assert.equal(await page.locator('.provider-form').count(), 0);
    assert.equal(await page.locator('.provider-list button').count(), 0);
    await page.getByRole('button', { name: '添加接口', exact: true }).click();
    await page.getByLabel('接口名称').fill('API One');
    await page.getByLabel('接口地址').fill('https://provider.example/v1');
    await page.getByLabel('模型', { exact: true }).fill('fixture-model');
    await page.getByLabel('API Key', { exact: true }).fill('fixture-secret-key');
    await page.getByRole('button', { name: '保存并使用', exact: true }).click();
    assert.equal(await page.locator('.provider-form').count(), 0);
    await page.getByRole('button', { name: 'API One', exact: true }).click();
    assert.equal(await page.getByLabel('接口地址').inputValue(), 'https://provider.example/v1');
    await page.getByLabel('接口名称').fill('Unsaved draft');
    await page.getByRole('tab', { name: '个性化', exact: true }).click();
    assert.equal(await page.getByLabel('接口名称').isVisible(), false);
    await page.getByRole('button', { name: '浅色', exact: true }).click();
    await page.getByRole('button', { name: '红涨绿跌', exact: true }).click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    assert.equal(await page.locator('html').getAttribute('data-price-colors'), 'red-up');
    await page.getByRole('tab', { name: '语言', exact: true }).click();
    await page.getByRole('button', { name: 'English', exact: true }).click();
    assert.equal(await page.getByRole('tabpanel', { name: 'Language', exact: true }).count(), 1);
    await page.getByRole('tab', { name: 'AI settings', exact: true }).click();
    assert.equal(await page.getByLabel('Provider name').inputValue(), 'Unsaved draft');
    await page.getByRole('tab', { name: 'AI settings', exact: true }).press('ArrowDown');
    assert.equal(await page.getByRole('tab', { name: 'Appearance', exact: true }).getAttribute('aria-selected'), 'true');
    await page.getByRole('tab', { name: 'Appearance', exact: true }).press('ArrowDown');
    assert.equal(await page.getByRole('tab', { name: 'Language', exact: true }).getAttribute('aria-selected'), 'true');
    for (const width of [1440, 1024, 375]) {
      await page.setViewportSize({ width, height: 900 });
      for (const label of ['AI settings', 'Appearance', 'Language']) {
        await page.getByRole('tab', { name: label, exact: true }).click();
        const result = await page.evaluate(() => {
          const dialog = document.querySelector('.settings-dialog');
          const nav = document.querySelector('.settings-nav').getBoundingClientRect();
          const content = document.querySelector('.settings-content');
          const panel = content.getBoundingClientRect();
          const tabs = [...document.querySelectorAll('.settings-nav [role="tab"]')].map(el => el.getBoundingClientRect().toJSON());
          return { width: innerWidth, nav: nav.toJSON(), panel: panel.toJSON(), tabs,
            overflow: dialog.scrollWidth > dialog.clientWidth + 1 || content.scrollWidth > content.clientWidth + 1,
            visiblePanels: [...document.querySelectorAll('.settings-panel')].filter(el => !el.hidden).length };
        });
        assert.equal(result.visiblePanels, 1);
        assert(!result.overflow, JSON.stringify(result));
        assert(result.nav.right <= result.panel.left + 1, 'Navigation must stay on the left');
        assert(result.tabs.every(tab => Math.abs(tab.x - result.tabs[0].x) < 1));
        assert(result.tabs[0].y < result.tabs[1].y && result.tabs[1].y < result.tabs[2].y);
        layouts.push({ label, ...result });
        await page.screenshot({ path: `.local/settings-sections-${width}-${label.replace(' ', '-')}.png` });
      }
    }
    await page.getByRole('button', { name: '中文', exact: true }).click();
    await page.getByRole('tab', { name: 'AI 配置', exact: true }).click();
    assert.equal(await page.getByLabel('接口名称').inputValue(), 'Unsaved draft');
    await page.getByRole('button', { name: '返回接口列表', exact: true }).click();
    assert.equal(await page.locator('.provider-form').count(), 0);
    await page.getByRole('button', { name: 'API One', exact: true }).waitFor();
    assert(!(await page.locator('#settings-panel-ai').innerText()).includes('fixture-secret-key'));
    await page.screenshot({ path: '.local/settings-provider-list-375.png' });
    await page.getByRole('button', { name: 'API One', exact: true }).click();
    await page.getByRole('button', { name: '删除', exact: true }).click();
    assert.equal(await page.locator('.provider-form').count(), 0);
    assert.equal(await page.locator('.provider-list button').count(), 0);
    await page.getByRole('button', { name: '关闭设置', exact: true }).click();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    assert.equal(await page.getByRole('tab', { name: 'AI 配置', exact: true }).getAttribute('aria-selected'), 'true');
    assert.deepEqual(errors, []);
    const report = { checked_at: new Date().toISOString(), left_navigation_sections: ['AI settings', 'Appearance', 'Language'],
      list_before_editor: true, save_returns_to_list: true, edit_and_delete: true, cancel_does_not_save: true,
      unsaved_draft_retained: true, keyboard_navigation: true, layouts, javascript_errors: errors };
    fs.writeFileSync('reports/settings-sections-browser-check.json', JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ checked_at: report.checked_at, left_navigation_sections: report.left_navigation_sections,
      unsaved_draft_retained: true, keyboard_navigation: true, checked_layouts: layouts.length, javascript_errors: errors }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
