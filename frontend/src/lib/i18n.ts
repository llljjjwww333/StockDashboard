import { create } from 'zustand';

export type Language = 'zh' | 'en';
const storageKey = 'marketdesk:language:v1';
function readLanguage(): Language {
  try { return localStorage.getItem(storageKey) === 'en' ? 'en' : 'zh'; } catch { return 'zh'; }
}
export const useLanguage = create<{ language: Language; setLanguage: (language: Language) => void }>(set => ({
  language: readLanguage(), setLanguage: language => set({ language }),
}));
function applyLanguage(language: Language) {
  document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
  document.title = language === 'en' ? 'ZPBOARD · Market Intelligence' : 'ZPBOARD · 市场研究';
}
applyLanguage(useLanguage.getState().language);
useLanguage.subscribe(({ language }) => {
  applyLanguage(language);
  try { localStorage.setItem(storageKey, language); } catch { /* Keep in-memory preferences available. */ }
});
window.addEventListener('storage', event => {
  if (event.key === storageKey || event.key === null) useLanguage.setState({ language: readLanguage() });
});

const english: Record<string, string> = {
  '研究台': 'Workspace', '市场': 'Markets', '情报': 'News', '主导航': 'Main navigation',
  '自选': 'Watchlist', '默认': 'Default', '涨幅': 'Change', '等待报价': 'Awaiting quote',
  '已连接': 'Connected', '连接中': 'Connecting', '重新连接中': 'Reconnecting',
  '美股': 'US', 'A 股': 'China', '搜索股票': 'Search stocks', '股票搜索结果': 'Stock search results',
  '搜索结果': 'Search results', '正在检索': 'Searching', '没有找到匹配标的': 'No matching stocks',
  '设置': 'Settings', '暂无自选股': 'Your watchlist is empty', '搜索并添加股票': 'Search and add stocks',
  '延时': 'Delayed', '缓存': 'Cached', '行情暂不可用': 'Quotes unavailable', '历史行情暂不可用': 'Price history unavailable',
  '指标历史暂不可用': 'Indicator history unavailable', '市场暂不可用': 'Market data unavailable', '资讯暂不可用': 'News unavailable', '搜索暂不可用': 'Search unavailable',
  '走势': 'Chart', '图表类型': 'Chart type', '折线': 'Line', 'K线': 'Candles', '加载中': 'Loading',
  '1日': '1D', '1周': '1W', '1月': '1M', '3月': '3M', '1年': '1Y',
  '分时': 'Intraday', '五日': '5 days', '1分钟 · ': '1 min · ', '前复权 · ': 'Adjusted · ', '较昨收': 'Vs prev. close',
  '均价': 'VWAP', '仅日K线可用': 'Available for daily candles',
  'K线周期': 'Candle interval', '时间范围': 'Time range', '日K': 'Daily', '仅K线可用': 'Available for candles',
  '沉浸看盘': 'Focus mode', '退出沉浸': 'Exit focus mode', 'AI 趋势线': 'AI trendlines',
  '五档盘口': 'Order book', '手': 'Lots', '卖{level}': 'Ask {level}', '买{level}': 'Bid {level}', '价差': 'Spread', '委买占比': 'Bid share', '暂无盘口': 'No order book',
  '图表工具': 'Chart tools', '价格刻度': 'Price scale', '普通': 'Linear', '对数': 'Log', '重置视图': 'Reset view', '回到最新': 'Go to latest',
  '水平线': 'Horizontal line', '清除画线': 'Clear drawings', '保存图表': 'Save chart', '全屏图表': 'Expand chart', '退出全屏': 'Exit full screen', '较前一根': 'Vs previous bar', '前复权': 'Adjusted',
  '休市': 'Closed', '集合竞价': 'Auction', '交易时段': 'Trading hours', '午间休市': 'Lunch break', '盘前': 'Pre-market', '盘后': 'Post-market', '已收盘': 'Closed',
  '1分钟': '1 min', '5分钟': '5 min', '15分钟': '15 min', '30分钟': '30 min', '60分钟': '60 min', '{count}分钟': '{count} min',
  '今开': 'Open', '最高': 'High', '最低': 'Low', '成交量': 'Volume', '成交额': 'Value', '换手率': 'Turnover',
  '昨收': 'Prev. close', '振幅': 'Amplitude', '量比': 'Volume ratio', '市盈率': 'P/E', '市净率': 'P/B', '总市值': 'Market cap',
  '领涨': 'Gainers', '领跌': 'Losers', '全部': 'All', '资讯': 'News', '更多': 'More', '暂无新闻': 'No news',
  '涨跌分布': 'Market breadth', '样本': 'Sample', '查看市场': 'View markets', '上涨占比': 'Advancing',
  '上涨': 'Up', '平盘': 'Flat', '下跌': 'Down', '同步中': 'Updating', '美国市场': 'US market', '中国市场': 'China market',
  '全市场': 'Full market', '板块': 'Sectors', '排行': 'Rankings', '筛选财经新闻': 'Filter financial news',
  'A 股市场': 'China A-shares', '指数雷达': 'Index radar', '指数': 'Index', '上证指数': 'Shanghai Composite', '上证指数分时': 'Shanghai Composite intraday',
  '深证成指': 'Shenzhen Component', '创业板指': 'ChiNext Index', '科创50': 'STAR 50', '沪深300': 'CSI 300', '中证500': 'CSI 500',
  '中证1000': 'CSI 1000', '上证50': 'SSE 50', '北证50': 'BSE 50', '主板': 'Main Board', '科创板': 'STAR', '创业板': 'ChiNext', '北交所': 'BSE', '基金': 'Fund',
  '板块脉搏': 'Sector pulse', '行业': 'Industries', '概念': 'Themes', '板块类型': 'Sector category', '板块排序': 'Sort sectors',
  '跌幅': 'Loss', '个板块': 'sectors', '焦点板块': 'Sector focus', '领涨股': 'Top mover', '成分股': 'Constituents',
  '搜索板块': 'Search sectors', '清除板块搜索': 'Clear sector search', '返回板块': 'Back to sector',
  '板块分页': 'Sector pages', '成分股分页': 'Constituent pages', '上一页': 'Previous page', '下一页': 'Next page',
  '暂无板块': 'No sectors', '暂无成分股': 'No constituents', '指数行情暂不可用': 'Indices unavailable',
  '板块行情暂不可用': 'Sector data unavailable', '成分股暂不可用': 'Constituents unavailable',
  '所属行业': 'Industry', '关联板块': 'Related sector', '展开股票标签': 'Show all stock tags', '收起股票标签': 'Collapse stock tags',
  '收起': 'Collapse', '股票板块暂不可用': 'Stock sectors unavailable',
  '搜索资讯': 'Search news', '新闻来源': 'News source', '全部来源': 'All sources', '清除筛选': 'Clear filters',
  '没有匹配结果': 'No matching results', '关闭新闻': 'Close news', '关闭 ×': 'Close ×',
  '分析接口': 'Analysis provider', '分析中…': 'Analyzing…', 'AI 分析': 'AI analysis', '取消': 'Cancel', '清除': 'Clear',
  'AI 分析结果': 'AI analysis results', '分析结果': 'Analysis results', '关注': 'Watch', '分析失败': 'Analysis failed',
  '自定义接口': 'Custom provider', '通义千问': 'Qwen', '请填写名称、接口地址和模型': 'Enter a name, endpoint and model',
  '连接失败': 'Connection failed', '连接成功': 'Connected successfully', '关闭设置': 'Close settings', '外观': 'Appearance',
  '页面主题': 'Theme', '深色': 'Dark', '浅色': 'Light', '涨跌配色': 'Price colors',
  '绿涨红跌': 'Green up / Red down', '红涨绿跌': 'Red up / Green down', '语言': 'Language',
  'AI 接口': 'AI providers', '当前': 'Active', '＋ 添加接口': '+ Add provider', '已保存': 'Saved',
  'AI 配置': 'AI settings', '个性化': 'Appearance', '设置分类': 'Settings categories',
  '添加接口': 'Add provider', '编辑接口': 'Edit provider', '返回接口列表': 'Back to providers', '返回': 'Back',
  '预设': 'Preset', '自定义': 'Custom', '名称': 'Name', '接口名称': 'Provider name', '协议': 'Protocol', '接口协议': 'Provider protocol',
  '接口地址': 'API endpoint', '模型': 'Model', '模型 ID': 'Model ID', '隐藏': 'Hide', '显示': 'Show',
  '在此设备记住密钥': 'Remember key on this device', '测试中…': 'Testing…', '测试连接': 'Test connection',
  '保存并使用': 'Save and use', '删除': 'Delete',
  '指标': 'Indicators', '指标选择': 'Indicator selection', '重置': 'Reset', '主图': 'Overlays', '副图': 'Panels',
  '数据不足': 'Not enough data', '开': 'O', '高': 'H', '低': 'L', '收': 'C', '量': 'Vol',
  '暂无行情': 'No price history',
  '日线 · ': 'Daily · ', '北京时间': 'Beijing time', '美东时间': 'New York time', '区间变化': 'Period change',
  '柱 ': 'Hist ', '支撑': 'Support', '阻力': 'Resistance', '放量': 'Volume surge', '突破': 'Breakout', '转折': 'Reversal',
  'API Key 无效': 'Invalid API key', '接口拒绝访问': 'Access denied', '接口或模型不存在': 'Endpoint or model not found',
  '接口额度不足或请求过快': 'Quota exceeded or rate limited', '模型连接失败或响应无效': 'Model connection failed or invalid response',
  '模型未返回分析内容': 'Model returned no analysis', '模型结果格式不正确，请重试': 'Invalid model result; try again',
  '模型未返回分析结论': 'Model returned no conclusion', '模型未返回有效图表标注，请重试': 'No valid chart annotations; try again',
  '请选择股票': 'Select a stock', '没有可分析的新闻': 'No news to analyze', '行情数据不足': 'Not enough market data',
  '模型响应超时': 'Model response timed out', '接口地址格式不正确': 'Invalid endpoint URL',
  '无法解析接口地址': 'Cannot resolve endpoint', '请使用公网接口地址': 'Use a public endpoint',
  '等待 {ticker} 行情数据': 'Waiting for {ticker} market data', '移除 {ticker}': 'Remove {ticker}',
  '{count} 个结果': '{count} results', '更新 {time}': 'Updated {time}', '{count} 根K线': '{count} candles',
  '{count} 条资讯': '{count} news items', '{name} 指标图': '{name} indicator chart', '{ticker} 价格走势': '{ticker} price chart',
  '条': 'items', '模型接口返回 {code}': 'Model endpoint returned {code}',
};

export function t(key: string, values: Record<string, string | number> = {}): string {
  if (useLanguage.getState().language === 'en' && /^模型接口返回 \d+$/.test(key)) {
    return t('模型接口返回 {code}', { code: key.match(/\d+$/)![0] });
  }
  const text = useLanguage.getState().language === 'en' ? (english[key] ?? key) : key;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => String(values[name] ?? match));
}
export const getLocale = () => useLanguage.getState().language === 'en' ? 'en-US' : 'zh-CN';
