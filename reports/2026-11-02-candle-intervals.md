# 日 K 与分钟 K

日期：2026-11-02。已更新本机 API、构建产物和临时公网预览；未推送仓库或部署 Render。

此前 K 线中的 1 月 / 3 月 / 1 年只是日 K 的显示范围，缺少明确的日 K 入口及分钟 K 粒度。

现在点击 K 线后可在周期菜单选择日 K、1 / 5 / 15 / 30 / 60 分钟。日 K 的范围为 1 月 / 3 月 / 1 年；分钟 K 的范围为当天 / 五日，其中 1 分钟暂限当天。日 K 和分钟 K 分别记忆范围，连续点击 K 线保留选择。折线分时 / 五日仍使用原先的密集价格走势。

分钟 K 使用独立的真实 OHLC 请求与缓存：A 股东方财富、5 分钟以上以新浪备用；美股 Yahoo 双域名并行。请求 `candles=true`，与同粒度的价格快照分开缓存，避免把价格快照当作分钟 OHLC。美股排除盘前盘后及 16:00 单独收盘快照。分钟 K 的开高低收、成交量颜色、指标、时间标签和柱宽随周期变化，午休不被误判为缺失一根 K 线。

AI 请求携带当前 `chart_type` 和 interval；后端据此取同一类 OHLC 数据。相同股票和一分钟粒度下从 K 线切成折线时，旧 K 线分析不会出现在折线视图中。本轮 AI 验证使用受控请求和模型模拟，未调用用户外部密钥。

验证：

- 前端 32 项测试、后端 53 项测试通过，构建、ESLint 和 diff 空白检查通过。
- 真实 API 验证 600519 / AAPL 各六档，以及五日 5 分钟 K。当前 600519 为上午半天，1 / 5 / 15 / 30 / 60 分钟分别 120 / 24 / 8 / 4 / 2 根；AAPL 最近完整交易日分别 390 / 78 / 26 / 13 / 7 根。五日 5 分钟分别 216 / 390 根，均覆盖五个交易日。见 `minute-candles-live-check.json`，耗时包含服务端缓存，不作为冷启动性能保证。
- 浏览器覆盖全部档位、分钟指标启用、同粒度切换图表后的分析隐藏、英文周期标签，以及 375 / 1024 / 1440 宽度；无横向溢出及 JavaScript 异常。见 `candle-intervals-browser-check.json`。
- 公网预览验证 AAPL 一分钟 390 根、600519 五日 5 分钟 216 根、日 K 菜单，以及五日折线返回日 K 不跳错周期。见 `candle-intervals-public-check.json`。
- 免费源仍会偶发 SSL 超时，已有缓存保留并后台刷新。测试途中 AAPL 60 分钟首次读取遇到一次源站超时，后续重试恢复。

复查命令：

```powershell
backend/.venv/Scripts/python.exe scripts/check_minute_candles.py
# 配置已安装 Playwright 的 PLAYWRIGHT_MODULE 后：
node scripts/check_candle_intervals.cjs
node scripts/check_candle_public.cjs
```
