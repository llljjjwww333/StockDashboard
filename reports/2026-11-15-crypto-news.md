# 资讯与桌面体验更新

访问入口：https://variables-fact-tin-stan.trycloudflare.com/?view=news&market=CRYPTO 。

## 新闻接入

接入[PANews](https://www.panewslab.com/zh/rss)、[ChainCatcher](https://www.chaincatcher.com/rss.xml)、[CoinDesk](https://www.coindesk.com/arc/outboundfeeds/rss/)及[Cointelegraph](https://cointelegraph.com/rss)。当前聚合接口返回200条，默认显示中文，并保留英文切换。

后端按来源独立刷新、缓存和持久化，返回来源状态与实际抓取时间。文章保留来源、发布时间、原文链接、语言、主题和币种标记；清理HTML与追踪参数，按URL及相同标题去重，排除未来时间和过期文章。

## 桌面交互

- 资讯列表支持来源、语言、币种、主题、24小时/7日范围和关键词组合筛选。
- 支持收藏、取消收藏、已读和未读筛选；收藏与阅读记录保存在浏览器，刷新继续可用。
- 新闻阅读框展示摘要和原文入口，可收藏文章、打开相关币种行情；返回资讯后保留筛选。
- 首页优先显示当前币种的相关资讯；列表支持分段加载和手动刷新。
- 新闻AI分析使用当前筛选出的文章快照。

## 修复与文案

修复浏览器缓存层仍把CRYPTO新闻视为ALL市场的错误。这一错误会使有效的HTTP200新闻响应被拒收，现已增加CRYPTO市场匹配及元数据校验测试。

清理策略编辑器、执行条件、运行摘要和回测页面中多余的防御性说明。参数解释收进“参数说明”，保留实际参数及交易条件。虚拟币分批计划改为小数币量说明；AI图表接口保留小数成交量。

## 验证

- 前端285项测试通过，ESLint无警告，生产构建通过。
- 后端52项相关测试通过，覆盖逐来源缓存与失败恢复、RSS解析、新闻分析快照、分批策略和小数成交量。
- `crypto-news-check.json`：本地1600宽度，使用真实新闻接口完成筛选、收藏、刷新、已读、原文链接、币种跳转、返回及继续加载。
- `crypto-news-public-check.json`：新公网入口完成相同真实数据流程，四个来源均为live；页面异常及API失败均为0。
- `crypto-desktop-news-regression.json`：新公网复查真实行情、十档盘口、搜索、排行、366根完成日线回测，以及0.001 BTC模拟买入、当日卖出和刷新恢复，全部通过。

本次仅调整桌面端。原股票工作区数据保留。

修改前相关文件：`.local/before-crypto-news-20261115.zip`。
