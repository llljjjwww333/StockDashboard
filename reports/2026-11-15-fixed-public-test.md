# 固定公网测试站

前端：https://stock-dashboard-web-rf7v.onrender.com

API：https://stock-dashboard-api-trec.onrender.com

现有Render服务连接仓库 `llljjjwww333/StockDashboard` 的 `master` 分支。每批修改先本地检查，再推送这条分支，由Render更新同一组服务，继续使用上述地址。

本地预览仍使用 http://127.0.0.1:5176 。

前端保留原有浏览器存储键，部署更新沿用同一地址的API配置、自选、策略、收藏与模拟账户。首次在固定地址填写接口后，勾选“在此设备记住密钥”，保存并使用。

`render.yaml` 已固定仓库分支、自动部署及API/WebSocket地址。部署包包含当前应用源码、资源与测试，排除环境文件、密钥、浏览器数据、运行缓存和日志。
