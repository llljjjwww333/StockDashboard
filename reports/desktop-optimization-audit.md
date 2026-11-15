# 桌面网站优化验收

应用提交：`9fb5d5baeeeaff67e8e3060c808ff430c0acb557`；页面资源：`index-Bm1vW6nv.js`；API：`ca50f8f38159`。

公网地址：https://stock-dashboard-web-rf7v.onrender.com 。Render 前端部署7804990634成功，实际入口资源与构建一致。

依据用户要求核对虚拟币桌面端的显示、操作逻辑和实用功能。以下是对完整使用流程的检查，不以单个绿色测试代替整体操作。

| 要求 | 当前证据 | 结果 |
|---|---|---|
| USDT现货桌面范围与旧数据保留 | [render-completion-crypto-flow.json](render-completion-crypto-flow.json), [render-crypto-watchlist-check.json](render-crypto-watchlist-check.json), [render-crypto-library-management-check.json](render-crypto-library-management-check.json), [render-account-management-check.json](render-account-management-check.json) | 通过 |
| 完整策略参数填入、可读编辑与刷新 | [render-completion-volatility-check.json](render-completion-volatility-check.json), [render-completion-desktop-workflows.json](render-completion-desktop-workflows.json) | 通过 |
| 策略设计与回测独立，回测不再生成策略 | [render-completion-crypto-flow.json](render-completion-crypto-flow.json), [render-completion-volatility-check.json](render-completion-volatility-check.json) | 通过 |
| 完整历史、预热、成本与无未来数据 | [render-completion-volatility-check.json](render-completion-volatility-check.json) | 通过 |
| 保存规则执行与显式AI动态模式 | [render-completion-desktop-workflows.json](render-completion-desktop-workflows.json), [render-completion-binding-limits.json](render-completion-binding-limits.json) | 通过 |
| 仓位上限、分批减仓和清仓优先 | [render-completion-binding-limits.json](render-completion-binding-limits.json) | 通过 |
| 交易数量、低价币价格与费用精度 | [render-completion-desktop-workflows.json](render-completion-desktop-workflows.json), [render-market-practical-check.json](render-market-practical-check.json) | 通过 |
| 大回测记录分页 | [render-completion-desktop-workflows.json](render-completion-desktop-workflows.json) | 通过 |
| 账户增删改查、导入导出与失败恢复 | [render-account-management-check.json](render-account-management-check.json) | 通过 |
| 策略库增删改查与失败恢复 | [render-crypto-library-management-check.json](render-crypto-library-management-check.json) | 通过 |
| 自选增删撤销、备份与范围检查 | [render-crypto-watchlist-check.json](render-crypto-watchlist-check.json) | 通过 |
| 市场成交额排行、单位和返回位置 | [render-market-practical-check.json](render-market-practical-check.json) | 通过 |
| 真实资讯、筛选、收藏、阅读和跳转 | [render-news-management-audit.json](render-news-management-audit.json) | 通过 |
| 接口配置保存、刷新与新会话 | [render-profile-current-check.json](render-profile-current-check.json) | 通过 |
| 刷新失败与恢复时页面位置稳定 | [render-completion-realtime-check.json](render-completion-realtime-check.json) | 通过 |
| 原生盘口高频更新和突发只呈现最新帧 | [render-completion-realtime-check.json](render-completion-realtime-check.json), [render-completion-book-cadence.json](render-completion-book-cadence.json), [book-processing-check.json](book-processing-check.json) | 通过 |
| 固定公网地址和发布验证 | [render-completion-crypto-flow.json](render-completion-crypto-flow.json), [render-profile-current-check.json](render-profile-current-check.json) | 通过 |

317项前端测试、135项后端测试通过；构建与lint通过。后端代码与健康接口报告的ca50f8f38159一致。

最终版本重新通过真实行情/搜索/历史回测/0.001币买卖，以及自选、策略、账户、资讯、配置的浏览器操作。BTC原参数表填入SMA200×1.01、MOM90、30日波动率、10%目标、45%上限和相应费用日期；历史为3377根，交易区间3176个UTC日。模型输出由测试响应提供，后端另以完整目标和输出schema测试核对并拒绝错误默认值。

盘口正常刷新检查约10.97次原生深度更新/秒；503失败和恢复时页面滚动范围及内容位移均为0。4倍CPU压力下，200条突发仅绘制最新1帧，十档共20行，没有意外的REST替代轮询。

压力下的接收间隔存在抖动。本次独立检查中，浏览器协议层间隔与页面消息层间隔一致；页面相对协议层额外分发延迟P95为1ms，最大1ms。长任务最大150ms。该证据支持页面没有积压盘口消息后逐条重播；不把协议事件时间当作交易所网络线路的直接测量。

一次市场检查等待成功响应超过原脚本30秒窗口，随后使用与其他行情检查一致的90秒窗口复核通过；本轮未更改连接实现。

移动端优化、网络连接方案改造和重连验收按用户要求不在本次范围。实际付费模型没有被调用；相关界面、请求协议、字段覆盖和失败状态通过测试响应及后端测试核对。

本次所列显示、操作与实用功能要求均已有当前版本证据，未留下已知且属于本次范围的必做修复。原始核对记录与文件校验值见[desktop-optimization-audit.json](desktop-optimization-audit.json)。
