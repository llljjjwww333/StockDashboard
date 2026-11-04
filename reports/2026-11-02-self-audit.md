# 自检与优化

日期：2026-11-02。范围：行情与图表、指标、AI 上下文、设置、语言与外观、页面轮询、手机和平板布局，以及数据源可访问性。

## 修复

- 刷新恢复 K 线类型、分钟 / 日 K 粒度、显示范围及各自上次范围。保存内容经校验，损坏或不可用的存储不影响打开页面。
- 下拉框、输入框、输入法和设置 / 新闻弹窗内不触发全站页面及股票快捷键。
- 切换股票、粒度、图表类型、接口或语言后清除旧分析上下文，往返切换不再重新显示旧结论；进行中的旧请求会取消。
- 历史行情、指标预取和选中股票 HTTP 报价仅在看盘页轮询；情报页暂停市场概览，市场页暂停新闻轮询。后台标签页暂停 HTTP 轮询，回前台立即刷新。自选股 WebSocket 继续接收推送。
- 稳定图表的空历史与标注数组引用，使历史图的 memo 能在仅报价变化时生效。
- 源站刷新失败但已有真实历史时保留图表与缓存状态，减少重复错误横幅；无历史时仍显示错误。

## 验证

- 前端 34 项、后端 53 项测试通过；TypeScript / Vite 构建、ESLint 通过。
- 受控浏览器检查覆盖周期刷新恢复、表单 / 弹窗快捷键、分析往返清除、行情异常保留缓存、新闻筛选与正文弹窗。375 / 768 / 1024 / 1440 宽度的研究台 / 市场 / 情报共 12 个布局无横向溢出，无 JavaScript 异常。记录：`self-audit-browser-check.json`。
- 受控时钟推进 65 秒：隐藏标签页发起 0 个新 API 请求；情报页发起 0 个历史 / 选中股票报价 HTTP 请求；恢复可见后确认重新请求。这是浏览器逻辑测试，不是墙钟运行 65 秒的性能测量。
- 连续注入 5 次更新报价，主报价均显示更新，未变化历史图中的 DateTimeFormat 调用增加 0 次。该计数核验本轮减少重复图表计算的效果，不作为总体帧率或 CPU 基准。
- 延迟并挂起历史响应时，切回缓存 58 毫秒、刷新恢复 187 毫秒，均可在网络未返回时显示；单根 K 线继续正常。记录：`loading-browser-check.json`。
- 15 个指标、9 条主图指标线、7 个副图、MA60 预取、成交量开关、重置和偏好保存均通过；375 / 1024 布局通过。记录：`indicators-browser-check.json`。
- 设置分栏、接口列表 / 增删改、未保存草稿、键盘切栏、语言、主题和红绿转换检查通过，覆盖 9 个设置布局。记录：`settings-sections-browser-check.json`。
- 11 个源站探测和 10 个应用 API 探测本轮全部 HTTP 200，包含中美股报价、历史、搜索、新闻和市场概览。记录：`self-audit-sources.json`。部分历史和概览首先返回真实过期缓存并后台更新，HTTP 成功不等于交易所实时性；随后确认 A 股完整快照更新至本轮时间，覆盖 5577 只。

已更新构建产物并用于本机和临时公网预览。公网检查记录在 `candle-intervals-public-check.json`，核验日 K / 分钟 K、刷新保留选择和下拉框快捷键行为。未推送 GitHub、未更新 Render；AI 浏览器验证使用受控接口，未验证真实模型质量。免费源与临时隧道仍可能波动。

复查：

```powershell
# 已安装 Playwright 并配置 PLAYWRIGHT_MODULE
node scripts/check_self_audit.cjs
node scripts/check_settings_layout.cjs
node scripts/check_indicators.cjs
node scripts/check_loading.cjs
node scripts/check_candle_public.cjs
backend/.venv/Scripts/python.exe scripts/check_sources.py --api http://127.0.0.1:8000 --output reports/self-audit-sources.json
```
