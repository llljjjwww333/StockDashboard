# 弱网、竞态与触控检查

日期：2026-11-02。接续上一轮自检，重点检查断网与恢复、慢响应交错、图表触控和行情缓存。

## 改动

- 离线时停止 HTTP 轮询、取消当前资源的未完成请求、保留真实缓存并标记过期。恢复联网立即拉取当前资源，WebSocket 重连及重新订阅不等待旧的退避计时。
- 取消后的旧请求即使迟到，也不能写回缓存，或删除同地址的新请求记录。
- 行情响应校验股票身份、OHLC 范围及有限数值。分钟 K 请求只接受 `price_type=ohlc`；错误股票和价格快照不会进入分钟 K 缓存。
- 主图与指标副图共用触控处理：点按保留读数，横向拖动逐点查看，纵向允许滚动页面；副图触控与主图联动。
- 图表可聚焦后使用左右箭头、Home、End 和 Escape 查看 / 退出读数；离开主图时取消未完成的鼠标帧回调，避免十字线重新冒出。

## 验证结果

- 前端 38 项、后端 53 项测试通过，覆盖新增的取消请求与替代请求竞态、股票错配、快照冒充 K 线、无效 OHLC 保留原缓存；构建及 ESLint 通过。
- `resilience-browser-check.json`：故意挂起 AAPL 历史，再切 NVDA 并放行旧结果，仍保持 NVDA；分析期间切周期后放行旧模型结果，未出现旧结论。
- 受控浏览器切为离线，推进 65 秒期间 0 个新 API 请求，缓存图表保留；恢复联网后约 146 毫秒更新到新报价及图表，WebSocket 创建新连接。这是模拟接口和浏览器时钟的功能验证，不是公网恢复延迟承诺。
- 同一检查实际向 Chromium 注入触控输入，覆盖 375 与 1024 宽度：点按保留第 30 根读数，横拖到第 95 根；纵向手势滚动 135 像素并取消查看状态；RSI 副图可以联动主图。无 JavaScript 异常。该验证不等同于在实体 iPad / Safari 上实测。
- 受控快照响应未被画为分钟 K，恢复正确 OHLC 后可以绘制；图表键盘导航与快速移出鼠标的十字线检查通过。
- 原自检回归 `self-audit-browser-check.json` 通过：偏好恢复、弹窗快捷键、旧分析清除、后台暂停、报价更新减少历史图计算、新闻筛选、12 个页面 / 屏幕宽度布局。

已更新本地构建并用于临时公网预览。公网日 K / 分钟 K、刷新保留选择、下拉框快捷键检查记录在 `candle-intervals-public-check.json`。未推送 GitHub 或更新 Render；没有调用用户真实 AI 密钥。

复查：

```powershell
cd frontend
node --experimental-strip-types --test tests/*.test.mjs
npm run build
npm run lint
cd ..
# 已配置 PLAYWRIGHT_MODULE：
node scripts/check_resilience.cjs
node scripts/check_self_audit.cjs
node scripts/check_candle_public.cjs
```
