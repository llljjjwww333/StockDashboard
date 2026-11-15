# 固定公网测试站

前端：https://stock-dashboard-web-rf7v.onrender.com

API：https://stock-dashboard-api-trec.onrender.com

现有Render服务连接仓库 `llljjjwww333/StockDashboard` 的 `master` 分支。每批修改先本地检查，再推送这条分支，由Render更新同一组服务，继续使用上述地址。

本地预览仍使用 http://127.0.0.1:5176 。

前端保留原有浏览器存储键，部署更新沿用同一地址的API配置、自选、策略、收藏与模拟账户。首次在固定地址填写接口后，勾选“在此设备记住密钥”，保存并使用。

`render.yaml` 已固定仓库分支、自动部署及API/WebSocket地址。部署包包含当前应用源码、资源与测试，排除环境文件、密钥、浏览器数据、运行缓存和日志。

## 发布验证

应用发布版本：`76292f92d641865138600f22584fa1d569601eb7`。Render前后端部署均成功，API健康检查返回相同应用版本。

部署工作区独立安装依赖后，285项前端、52项后端测试及生产构建通过。

- `render-profile-retention-check.json`：在旧版固定站保存测试配置，发布后继续读取同一份配置；刷新与新浏览器会话均保留已勾选记住的测试密钥。
- `render-news-public-check.json`：固定站真实新闻接口、四个来源、筛选、收藏、阅读及币种跳转通过。
- `render-desktop-public-check.json`：固定站真实报价、十档盘口、搜索、市场排行、366根完成日线回测，以及0.001 BTC模拟买入/同日卖出和刷新恢复通过。

网站由Render运行，本机调试进程无需为该公网入口持续运行。
