
import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { buildApiUrl, getCurrencySymbol } from './lib/api';
import { stockWebSocketService } from './services/stockWebSocketService';
import { type MarketType, useStockQuoteStore, useStockStore } from './store/stockStore';

type PeriodKey = '1d' | '1wk' | '1mo' | '3mo' | '1y';
type IntradayInterval = '5m' | '15m';
type Language = 'zh' | 'en';
type TopModule = 'dashboard' | 'hot' | 'news';
type SearchResult = { ticker: string; name: string };
type HistoryPoint = { timestamp: string; open: number; high: number; low: number; close: number; volume: number };
type QuoteResponse = {
  ticker: string;
  price: number;
  volume: number;
  change_percent: number;
  change?: number | null;
  open_price?: number | null;
  high_price?: number | null;
  low_price?: number | null;
  previous_close?: number | null;
  amount?: number | null;
  turnover_rate?: number | null;
  amplitude_percent?: number | null;
};
type HotspotRow = {
  ticker: string;
  name: string;
  price: number;
  change_percent: number;
  change?: number | null;
  volume: number;
  amplitude_percent?: number | null;
};
type HotspotResponse = {
  market: MarketType;
  indices: HotspotRow[];
  sectors?: (HotspotRow & { sector?: string })[];
  leaders: HotspotRow[];
  laggards: HotspotRow[];
  active: HotspotRow[];
  breadth: {
    advancers: number;
    decliners: number;
    flat: number;
    total: number;
  };
  summary: {
    market: MarketType;
    mode: string;
    breadth_ratio: number;
    up?: number;
    down?: number;
    flat?: number;
    limit_up?: number;
    limit_down?: number;
    new_high?: number;
    new_low?: number;
    main_flow_net?: number;
    sh_change?: number;
    sz_change?: number;
    proxy_count?: number;
    vix?: number | null;
    vix_change?: number | null;
    activity_ratio?: number | null;
    halted?: number | null;
    universe_count?: number | null;
  };
  updated_at: string;
};
type DetailState = { history: HistoryPoint[]; related: string[]; loading: boolean; error: string | null; lastUpdated: string | null };
type SnapshotState = { quote: QuoteResponse | null; history: HistoryPoint[]; loading: boolean; error: string | null; lastUpdated: string | null };
type NewsItem = {
  title: string;
  summary: string;
  published_at: string;
  source: string;
  url?: string | null;
  market: string;
};
type NewsResponse = {
  market: string;
  updated_at: string;
  keywords: string[];
  items: NewsItem[];
};
type AiProvider = 'deepseek' | 'qwen' | 'custom';
type AiProviderConfig = {
  baseUrl: string;
  model: string;
  apiKey: string;
};
type AiSettings = {
  enabled: boolean;
  activeProvider: AiProvider;
  providers: Record<AiProvider, AiProviderConfig>;
};
type AiNewsInsights = {
  provider: string;
  model: string;
  language: string;
  analyzed_at: string;
  summary: string;
  keywords: string[];
};
type AiContextInsights = {
  provider: string;
  model: string;
  language: string;
  context_type: 'dashboard' | 'hotspot';
  analyzed_at: string;
  title: string;
  summary: string;
  sentiment: string;
  signals: string[];
  risks: string[];
};
type SettingsSection = 'general' | 'chart' | 'ai';
type UiSettings = {
  newsRefreshSeconds: 30 | 60 | 120;
  colorMode: 'greenUp' | 'greenDown';
};
type WatchlistPreviewMap = Record<string, HistoryPoint[]>;
type ProviderEditorState = {
  mode: 'create' | 'edit';
  provider: AiProvider;
};
type HeatmapRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const DETAIL_CACHE_TTL_MS = 2 * 60 * 1000;
const SNAPSHOT_CACHE_TTL_MS = 60 * 1000;
const HOTSPOT_CACHE_TTL_MS = 15 * 60 * 1000;
const NEWS_CACHE_TTL_MS = 2 * 60 * 1000;
const DEFAULT_LEFT_PANEL_WIDTH = 340;
const DEFAULT_SEARCH_PANEL_HEIGHT = 260;
const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: false,
  activeProvider: 'deepseek',
  providers: {
    deepseek: {
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      apiKey: '',
    },
    qwen: {
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-plus',
      apiKey: '',
    },
    custom: {
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: '',
    },
  },
};
const DEFAULT_UI_SETTINGS: UiSettings = {
  newsRefreshSeconds: 60,
  colorMode: 'greenUp',
};
const getMsUntilEndOfDay = () => {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return Math.max(next.getTime() - now.getTime(), 60 * 1000);
};

const CHINA_TIMEZONE = 'Asia/Shanghai';
const getTodayCacheTag = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CHINA_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
};
const getNewsFingerprint = (items: NewsItem[]) =>
  items
    .map((item) => `${item.source}|${item.published_at}|${item.title}`)
    .join('||');
const isAiProviderConfigured = (config: AiProviderConfig) =>
  Boolean(config.baseUrl.trim() && config.model.trim() && config.apiKey.trim());

const readCachedValue = <T,>(key: string, ttlMs: number): T | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as { savedAt: number; value: T };
    if (!parsed?.savedAt || Date.now() - parsed.savedAt > ttlMs) {
      window.localStorage.removeItem(key);
      return null;
    }

    return parsed.value;
  } catch {
    return null;
  }
};

const writeCachedValue = <T,>(key: string, value: T) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), value }));
  } catch {
    // Ignore storage quota or serialization issues for UI cache.
  }
};

const periodOptions: Array<{ key: PeriodKey; label: string }> = [
  { key: '1d', label: '1D' },
  { key: '1wk', label: '1W' },
  { key: '1mo', label: '1M' },
  { key: '3mo', label: '3M' },
  { key: '1y', label: '1Y' },
];
const intervalByPeriod: Record<PeriodKey, string> = { '1d': '5m', '1wk': '30m', '1mo': '1d', '3mo': '1d', '1y': '1d' };
const intradayIntervalOptions: Array<{ key: IntradayInterval; label: string }> = [{ key: '15m', label: '15m' }, { key: '5m', label: '5m' }];
const marketLabel: Record<MarketType, string> = { US: 'US', CN: 'CN' };
const formatSigned = (value: number, digits = 2) => `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
const tz = (market: MarketType) => (market === 'US' ? 'America/New_York' : 'Asia/Shanghai');
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const sumWeights = <T extends { weight: number }>(items: T[]) => items.reduce((total, item) => total + item.weight, 0);
const getHeatmapDensity = (rect: HeatmapRect) => {
  const minSide = Math.min(rect.width, rect.height);
  const area = rect.width * rect.height;

  if (minSide < 14 || area < 190) {
    return 'tight';
  }

  if (minSide < 20 || area < 320) {
    return 'compact';
  }

  return 'roomy';
};
const buildTreemapLayout = <T extends { weight: number }>(
  items: T[],
  bounds: HeatmapRect = { x: 0, y: 0, width: 100, height: 100 },
): Array<T & HeatmapRect> => {
  if (!items.length) {
    return [];
  }

  if (items.length === 1) {
    return [{ ...items[0], ...bounds }];
  }

  const totalWeight = Math.max(sumWeights(items), Number.EPSILON);
  let runningWeight = 0;
  let splitIndex = 1;
  let bestDelta = Number.POSITIVE_INFINITY;

  for (let index = 1; index < items.length; index += 1) {
    runningWeight += items[index - 1].weight;
    const delta = Math.abs((totalWeight / 2) - runningWeight);
    if (delta < bestDelta) {
      bestDelta = delta;
      splitIndex = index;
    }
  }

  const leadingItems = items.slice(0, splitIndex);
  const trailingItems = items.slice(splitIndex);

  if (!leadingItems.length || !trailingItems.length) {
    const midpoint = Math.ceil(items.length / 2);
    return buildTreemapLayout(items.slice(0, midpoint), {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width >= bounds.height ? bounds.width / 2 : bounds.width,
      height: bounds.width >= bounds.height ? bounds.height : bounds.height / 2,
    }).concat(buildTreemapLayout(items.slice(midpoint), {
      x: bounds.width >= bounds.height ? bounds.x + (bounds.width / 2) : bounds.x,
      y: bounds.width >= bounds.height ? bounds.y : bounds.y + (bounds.height / 2),
      width: bounds.width >= bounds.height ? bounds.width / 2 : bounds.width,
      height: bounds.width >= bounds.height ? bounds.height : bounds.height / 2,
    }));
  }

  const leadingWeight = sumWeights(leadingItems);
  const horizontalSplit = bounds.width >= bounds.height;

  if (horizontalSplit) {
    const leadingWidth = clamp((leadingWeight / totalWeight) * bounds.width, 0, bounds.width);
    return [
      ...buildTreemapLayout(leadingItems, {
        x: bounds.x,
        y: bounds.y,
        width: leadingWidth,
        height: bounds.height,
      }),
      ...buildTreemapLayout(trailingItems, {
        x: bounds.x + leadingWidth,
        y: bounds.y,
        width: bounds.width - leadingWidth,
        height: bounds.height,
      }),
    ];
  }

  const leadingHeight = clamp((leadingWeight / totalWeight) * bounds.height, 0, bounds.height);
  return [
    ...buildTreemapLayout(leadingItems, {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: leadingHeight,
    }),
    ...buildTreemapLayout(trailingItems, {
      x: bounds.x,
      y: bounds.y + leadingHeight,
      width: bounds.width,
      height: bounds.height - leadingHeight,
    }),
  ];
};
const ma = (data: HistoryPoint[], period: number) => data.map((point, index) => {
  const startIndex = Math.max(0, index - period + 1);
  const window = data.slice(startIndex, index + 1);
  if (window.length === 0) return null;
  return {
    timestamp: point.timestamp,
    value: window.reduce((sum, item) => sum + item.close, 0) / window.length,
  };
});

const inferMarketFromTicker = (ticker: string): MarketType =>
  /^\d{6}$/.test(ticker) ? 'CN' : 'US';
const tickerDomainMap: Record<string, string> = {
  AAPL: 'apple.com',
  MSFT: 'microsoft.com',
  GOOGL: 'google.com',
  AMZN: 'amazon.com',
  META: 'meta.com',
  TSLA: 'tesla.com',
  NVDA: 'nvidia.com',
  JPM: 'jpmorganchase.com',
  V: 'visa.com',
  JNJ: 'jnj.com',
  PFE: 'pfizer.com',
  SPY: 'ssga.com',
  QQQ: 'invesco.com',
  DIA: 'ssga.com',
  IWM: 'ishares.com',
  XLK: 'ssga.com',
  XLF: 'ssga.com',
  XLV: 'ssga.com',
  XLY: 'ssga.com',
  XLI: 'ssga.com',
  XLP: 'ssga.com',
  XLE: 'ssga.com',
  XLB: 'ssga.com',
  XLU: 'ssga.com',
  XLRE: 'ssga.com',
  XLC: 'ssga.com',
  '600519': 'moutaichina.com',
  '601318': 'pingan.com',
  '000858': 'wuliangye.com.cn',
  '600036': 'cmbchina.com',
  '601888': 'ctg.cn',
  '601899': 'zjky.cn',
  '601988': 'boc.cn',
  '601288': 'abchina.com',
  '600031': 'sanyglobal.com',
  '600276': 'hengrui.com',
  '300033': '10jqka.com.cn',
  '300059': 'eastmoney.com',
  '510050': 'huatai-pb.com',
  '510300': 'huatai-pb.com',
  '510500': 'huatai-pb.com',
  '159915': 'gf.com.cn',
  '588000': 'harvestwm.cn',
  '512480': 'guotaiamc.com',
  '512170': 'ebfund.com',
  '512010': 'guotaiamc.com',
  '512880': 'guotaiamc.com',
  '515030': 'csfunds.com.cn',
  '159928': 'e-fund.com.cn',
  '516160': 'csfunds.com.cn',
};

const getStockVisual = (ticker: string, name: string, market?: MarketType) => {
  const normalizedTicker = ticker.toUpperCase();
  const normalizedName = name.toLowerCase();
  const resolvedMarket = market ?? inferMarketFromTicker(ticker);
  const domain = tickerDomainMap[normalizedTicker] ?? tickerDomainMap[ticker];

  if (domain) {
    return {
      logoUrl: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`,
      glyph: resolvedMarket === 'CN' ? 'CN' : 'US',
      tone: resolvedMarket === 'CN' ? 'cn' : 'us',
    } as const;
  }

  if (normalizedTicker.startsWith('^') || normalizedName.includes('index') || normalizedName.includes('指数')) {
    return { glyph: '◎', tone: 'index' } as const;
  }
  if (normalizedName.includes('bank') || normalizedName.includes('finance') || normalizedName.includes('financial') || normalizedName.includes('证券') || normalizedName.includes('银行') || normalizedName.includes('券商')) {
    return { glyph: '¤', tone: 'finance' } as const;
  }
  if (normalizedName.includes('health') || normalizedName.includes('medical') || normalizedName.includes('medicine') || normalizedName.includes('医药') || normalizedName.includes('医疗')) {
    return { glyph: '+', tone: 'health' } as const;
  }
  if (normalizedName.includes('energy') || normalizedName.includes('新能源')) {
    return { glyph: '~', tone: 'energy' } as const;
  }
  if (normalizedName.includes('tech') || normalizedName.includes('semi') || normalizedName.includes('半导体') || normalizedName.includes('科创')) {
    return { glyph: '</>', tone: 'tech' } as const;
  }
  if (normalizedName.includes('consumer') || normalizedName.includes('消费') || normalizedName.includes('tourism')) {
    return { glyph: '◌', tone: 'consumer' } as const;
  }

  return {
    glyph: resolvedMarket === 'CN' ? 'CN' : 'US',
    tone: resolvedMarket === 'CN' ? 'cn' : 'us',
  } as const;
};

const localeByLanguage: Record<Language, string> = { zh: 'zh-CN', en: 'en-US' };
const periodDisplayLabel: Record<Language, Record<PeriodKey, string>> = {
  zh: { '1d': '分时', '1wk': '1周', '1mo': '1个月', '3mo': '3个月', '1y': '1年' },
  en: { '1d': 'Intraday', '1wk': '1 Week', '1mo': '1 Month', '3mo': '3 Months', '1y': '1 Year' },
};

const translations = {
  zh: {
    watchlist: '自选',
    home: '看板',
    hotspot: '热点',
    news: '资讯',
    newsTitle: '财经快讯',
    newsHint: '统一聚合实时财经热点，覆盖盘中异动、全球宏观和重点公司动态。',
    newsUpdated: '资讯更新时间',
    newsKeywords: '今日关键词',
    aiKeywords: 'AI 今日关键词',
    aiSummary: 'AI 资讯判断',
    aiSettings: 'AI 设置',
    generalSettings: '通用',
    chartSettings: '图表',
    languageSetting: '语言',
    newsRefresh: '资讯刷新频率',
    chartColorPreset: '涨跌配色方案',
    colorModeSetting: '涨跌颜色',
    greenUpMode: '绿涨红跌',
    greenDownMode: '红涨绿跌',
    activeAiProvider: '当前启用',
    savedProviders: '已保存接口',
    aiAddProvider: '添加接口',
    aiEditProvider: '编辑接口',
    aiSavedEmpty: '还没有配置任何 AI 接口。',
    aiProviderReady: '已配置',
    aiProviderMissing: '未配置',
    aiUseThis: '启用',
    aiEditing: '编辑中',
    refresh30s: '30 秒',
    refresh60s: '60 秒',
    refresh120s: '120 秒',
    settingsTitle: '偏好设置',
    settingsHint: '统一管理界面语言、资讯刷新节奏、图表视觉和 AI 接口配置。',
    aiProvider: 'AI 提供方',
    aiBaseUrl: '接口地址',
    aiModel: '模型',
    aiApiKey: 'API Key',
    aiEnable: '启用 AI 分析',
    aiSave: '保存设置',
    aiConfigured: 'AI 已配置',
    aiNotConfigured: '未配置 AI',
    aiNeedConfig: '请先在右上角配置 AI 接口。',
    aiAnalyzing: 'AI 分析中...',
    aiAnalysisFailed: 'AI 分析失败',
    aiAnalyze: 'AI 分析',
    aiAnalyzeDashboard: '分析当前时段',
    aiAnalyzeHotspot: '分析整体行情',
    aiProfessionalView: 'AI 专业建议',
    aiMarketSentiment: 'AI 市场情绪',
    aiSignals: '关键信号',
    aiRisks: '风险提示',
    aiSentiment: '情绪判断',
    aiAnalyzedAt: '分析时间',
    loadingTransition: '数据切换中...',
    newsEmpty: '暂无财经资讯。',
    newsOpen: '查看原文',
    hotspotTitle: '市场热点',
    hotspotHint: '免费版热点页聚焦板块强弱、核心指数，以及当日股票涨跌榜与活跃榜。',
    hotspotLead: '涨幅榜',
    hotspotSwing: '跌幅榜',
    hotspotActive: '活跃榜',
    marketOverview: '市场概览',
    marketBreadth: '涨跌分布',
    marketIndices: '核心指数',
    marketUpdated: '市场更新时间',
    marketSummary: '全市场概括',
    breadthRatio: '上涨占比',
    limitUp: '涨停',
    limitDown: '跌停',
    halted: '停牌',
    newHigh: '创新高',
    newLow: '创新低',
    mainFlow: '主力净流入',
    shIndex: '上证涨跌幅',
    szIndex: '深证涨跌幅',
    proxyMode: '代理口径',
    sectorHeatmap: '板块热力图',
    vixLabel: '波动/活跃度',
    usOnly: '免费版 · 热力总览',
    advancers: '上涨',
    decliners: '下跌',
    flatCount: '平盘',
    hotspotEmpty: '暂无市场热点数据。',
    heatmap: '热力图',
    volumePulse: '成交量脉冲',
    amplitudeMap: '振幅图谱',
    cacheReady: '已从本地缓存恢复，后台同步刷新中。',
    names: '只股票',
    addStock: '添加股票',
    searching: '搜索中...',
    searchHint: '按代码或名称搜索，并加入自选列表。',
    add: '添加',
    remove: '删除',
    volumeShort: '量',
    dailySnapshot: '当日快照',
    snapshot: '快照',
    waitingUpdate: '等待更新',
    last: '最新',
    change: '涨跌',
    amplitude: '振幅',
    candlestick: 'K线图',
    chartHint: '下方图表范围会切换，但上方快照始终显示今日交易时段数据。',
    loadingChart: '图表加载中...',
    noCandlestickData: '暂无K线数据。',
    sessionNotes: '交易摘要',
    sessionHint: '以下要点基于今日交易时段快照，而不是当前图表区间。',
    related: '相关标的',
    relatedHint: '来自后端推荐映射的快捷跳转列表。',
    noRelated: '暂无相关标的。',
    emptyWatchlist: '自选列表为空，请先在左侧添加股票。',
    pleaseAddStock: '请先添加一只股票。',
    failedToLoadMarketData: '加载行情数据失败',
    failedToLoadDailySnapshot: '加载日内快照失败',
    searchFailed: '搜索失败',
    unknownError: '未知错误',
    todayOpen: '今日开盘',
    previousClose: '昨收',
    todayHigh: '今日最高',
    todayLow: '今日最低',
    highMinusLow: '最高减最低',
    vsPrevClose: '相对昨收',
    todayVolume: '今日累计成交量',
    avgBarVolume: '5分钟均量',
    todayAmount: '今日成交额',
    shownWhenAvailable: '有数据时显示',
    open: '开盘',
    prevClose: '昨收',
    dayHigh: '日高',
    dayLow: '日低',
    dayRange: '日内波动',
    turnover: '成交额',
    turnoverRate: '换手率',
    avgBarVol: '均量',
    close: '收盘',
    range: '区间',
    summary: (name: string, open: string, high: string, low: string, last: string, volume: string) => `${name} 今日快照：开盘 ${open}，最高 ${high}，最低 ${low}，最新 ${last}，成交量 ${volume}。`,
    notes: {
      line1: (open: string, high: string, low: string, last: string) => `开盘 ${open}，最高 ${high}，最低 ${low}，最新 ${last}。`,
      line2: (range: string, amplitude: string) => `日内波动 ${range}，振幅 ${amplitude}%。`,
      line3: (volume: string, avg: string) => `成交量 ${volume}，5分钟均量 ${avg}。`,
    },
    sessionLabel: (market: MarketType, period: PeriodKey) => period !== '1d' && period !== '1wk' ? `${market} 市场交易时段视图` : market === 'US' ? '美股常规时段 09:30-16:00 ET' : 'A股常规时段 09:30-11:30 / 13:00-15:00',
    xAxisTimezone: (market: MarketType) => market === 'US' ? '横轴使用美东时间' : '横轴使用北京时间',
    chartAria: (ticker: string) => `${ticker} K线图`,
  },
  en: {
    watchlist: 'Watchlist',
    home: 'Dashboard',
    hotspot: 'Hotspot',
    news: 'News',
    newsTitle: 'Finance Wire',
    newsHint: 'A unified stream of real-time financial headlines, macro updates, and notable company developments.',
    newsUpdated: 'News Updated',
    newsKeywords: 'Today Keywords',
    aiKeywords: 'AI Keywords',
    aiSummary: 'AI Take',
    aiSettings: 'AI Settings',
    generalSettings: 'General',
    chartSettings: 'Chart',
    languageSetting: 'Language',
    newsRefresh: 'News Refresh',
    chartColorPreset: 'Price Color Mode',
    colorModeSetting: 'Up/Down Colors',
    greenUpMode: 'Green Up / Red Down',
    greenDownMode: 'Red Up / Green Down',
    activeAiProvider: 'Active Provider',
    savedProviders: 'Saved Providers',
    aiAddProvider: 'Add Provider',
    aiEditProvider: 'Edit',
    aiSavedEmpty: 'No AI providers configured yet.',
    aiProviderReady: 'Configured',
    aiProviderMissing: 'Not Set',
    aiUseThis: 'Use',
    aiEditing: 'Editing',
    refresh30s: '30 sec',
    refresh60s: '60 sec',
    refresh120s: '120 sec',
    settingsTitle: 'Preferences',
    settingsHint: 'Manage language, news refresh rhythm, chart visuals, and AI endpoint settings in one place.',
    aiProvider: 'Provider',
    aiBaseUrl: 'Base URL',
    aiModel: 'Model',
    aiApiKey: 'API Key',
    aiEnable: 'Enable AI analysis',
    aiSave: 'Save Settings',
    aiConfigured: 'AI Ready',
    aiNotConfigured: 'AI Not Set',
    aiNeedConfig: 'Configure your AI endpoint from the top-right settings first.',
    aiAnalyzing: 'AI analyzing...',
    aiAnalysisFailed: 'AI analysis failed',
    aiAnalyze: 'AI Analyze',
    aiAnalyzeDashboard: 'Analyze Current Range',
    aiAnalyzeHotspot: 'Analyze Market',
    aiProfessionalView: 'AI Trading View',
    aiMarketSentiment: 'AI Market Sentiment',
    aiSignals: 'Key Signals',
    aiRisks: 'Risk Notes',
    aiSentiment: 'Sentiment',
    aiAnalyzedAt: 'Analyzed',
    loadingTransition: 'Switching data...',
    newsEmpty: 'No financial news yet.',
    newsOpen: 'Open story',
    hotspotTitle: 'Market Hotspots',
    hotspotHint: 'This free hotspot page focuses on sector breadth, core indices, and daily stock mover boards.',
    hotspotLead: 'Top Gainers',
    hotspotSwing: 'Top Losers',
    hotspotActive: 'Most Active',
    marketOverview: 'Market Overview',
    marketBreadth: 'Breadth',
    marketIndices: 'Core Indices',
    marketUpdated: 'Market Updated',
    marketSummary: 'Whole Market Summary',
    breadthRatio: 'Advancer Ratio',
    limitUp: 'Limit Up',
    limitDown: 'Limit Down',
    halted: 'Halted',
    newHigh: 'New High',
    newLow: 'New Low',
    mainFlow: 'Main Flow',
    shIndex: 'Shanghai %',
    szIndex: 'Shenzhen %',
    proxyMode: 'Proxy Mode',
    sectorHeatmap: 'Sector Heatmap',
    vixLabel: 'Volatility / Activity',
    usOnly: 'Free Mode · Heat Dashboard',
    advancers: 'Advancers',
    decliners: 'Decliners',
    flatCount: 'Flat',
    hotspotEmpty: 'No market hotspot data yet.',
    heatmap: 'Heatmap',
    volumePulse: 'Volume Pulse',
    amplitudeMap: 'Amplitude Map',
    cacheReady: 'Loaded from local cache and refreshing in the background.',
    names: 'names',
    addStock: 'Add stock',
    searching: 'Searching...',
    searchHint: 'Search by ticker or name and add to your watchlist.',
    add: 'Add',
    remove: 'Remove',
    volumeShort: 'Vol',
    dailySnapshot: 'Daily Snapshot',
    snapshot: 'Snapshot',
    waitingUpdate: 'Waiting for update',
    last: 'Last',
    change: 'Change',
    amplitude: 'Amplitude',
    candlestick: 'Candlestick',
    chartHint: "The chart range changes below, but the snapshot above always stays on today's session data.",
    loadingChart: 'Loading chart...',
    noCandlestickData: 'No candlestick data.',
    sessionNotes: 'Session Notes',
    sessionHint: "These bullets use today's session snapshot instead of the selected chart range.",
    related: 'Related',
    relatedHint: 'Quick jump list from the backend recommendation mapping.',
    noRelated: 'No related names.',
    emptyWatchlist: 'Your watchlist is empty. Add a stock on the left first.',
    pleaseAddStock: 'Please add a stock first.',
    failedToLoadMarketData: 'Failed to load market data',
    failedToLoadDailySnapshot: 'Failed to load daily snapshot',
    searchFailed: 'Search failed',
    unknownError: 'Unknown error',
    todayOpen: 'Today open',
    previousClose: 'Previous close',
    todayHigh: 'Today high',
    todayLow: 'Today low',
    highMinusLow: 'High minus low',
    vsPrevClose: 'Vs prev close',
    todayVolume: 'Today cumulative volume',
    avgBarVolume: 'Average 5m bar volume',
    todayAmount: 'Today traded amount',
    shownWhenAvailable: 'Shown when available',
    open: 'Open',
    prevClose: 'Prev Close',
    dayHigh: 'Day High',
    dayLow: 'Day Low',
    dayRange: 'Day Range',
    turnover: 'Turnover',
    turnoverRate: 'Turnover Rate',
    avgBarVol: 'Avg Bar Vol',
    close: 'Close',
    range: 'Range',
    summary: (name: string, open: string, high: string, low: string, last: string, volume: string) => `${name} daily snapshot: open ${open}, high ${high}, low ${low}, last ${last}, volume ${volume}.`,
    notes: {
      line1: (open: string, high: string, low: string, last: string) => `Open ${open}, high ${high}, low ${low}, last ${last}.`,
      line2: (range: string, amplitude: string) => `Daily range is ${range} and amplitude is ${amplitude}%.`,
      line3: (volume: string, avg: string) => `Volume is ${volume} with average 5m bar volume ${avg}.`,
    },
    sessionLabel: (market: MarketType, period: PeriodKey) => period !== '1d' && period !== '1wk' ? `${market} market session view` : market === 'US' ? 'US cash session 09:30-16:00 ET' : 'CN cash session 09:30-11:30 / 13:00-15:00',
    xAxisTimezone: (market: MarketType) => market === 'US' ? 'XAxis uses ET' : 'XAxis uses Beijing time',
    chartAria: (ticker: string) => `${ticker} candlestick chart`,
  },
} as const;

const detectInitialLanguage = (): Language => {
  const storedLanguage = window.localStorage.getItem('stock-dashboard-language');
  if (storedLanguage === 'zh' || storedLanguage === 'en') return storedLanguage;
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
};

function App() {
  const { watchlist, selectedTicker, addToWatchlist, removeFromWatchlist, selectStock } = useStockStore();
  const quotes = useStockQuoteStore((state) => state.quotes);
  const updateLiveQuote = useStockQuoteStore((state) => state.updateStockQuote);
  const [language, setLanguage] = useState<Language>(() => detectInitialLanguage());
  const [activeModule, setActiveModule] = useState<TopModule>('dashboard');
  const [hotspotMarket, setHotspotMarket] = useState<MarketType>('US');
  const [activePeriod, setActivePeriod] = useState<PeriodKey>('1mo');
  const [intradayInterval, setIntradayInterval] = useState<IntradayInterval>('15m');
  const [searchText, setSearchText] = useState('');
  const [searchMarket, setSearchMarket] = useState<MarketType>('US');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hotspotState, setHotspotState] = useState<{ data: HotspotResponse | null; loading: boolean; error: string | null }>({ data: null, loading: false, error: null });
  const [hotspotUsedCache, setHotspotUsedCache] = useState(false);
  const [newsState, setNewsState] = useState<{ data: NewsResponse | null; loading: boolean; error: string | null }>({ data: null, loading: false, error: null });
  const [newsUsedCache, setNewsUsedCache] = useState(false);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general');
  const [providerEditor, setProviderEditor] = useState<ProviderEditorState | null>(null);
  const [aiSettings, setAiSettings] = useState<AiSettings>(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_AI_SETTINGS;
    }
    try {
      const stored = window.localStorage.getItem('stock-dashboard-ai-settings');
      if (!stored) {
        return DEFAULT_AI_SETTINGS;
      }
      const parsed = JSON.parse(stored) as Partial<AiSettings>;
      return {
        ...DEFAULT_AI_SETTINGS,
        ...parsed,
        providers: {
          ...DEFAULT_AI_SETTINGS.providers,
          ...(parsed.providers ?? {}),
        },
      };
    } catch {
      return DEFAULT_AI_SETTINGS;
    }
  });
  const [uiSettings, setUiSettings] = useState<UiSettings>(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_UI_SETTINGS;
    }
    try {
      const stored = window.localStorage.getItem('stock-dashboard-ui-settings');
      if (!stored) {
        return DEFAULT_UI_SETTINGS;
      }
      const parsed = JSON.parse(stored) as Partial<UiSettings>;
      return {
        ...DEFAULT_UI_SETTINGS,
        ...parsed,
      };
    } catch {
      return DEFAULT_UI_SETTINGS;
    }
  });
  const [aiInsightsState, setAiInsightsState] = useState<{ data: AiNewsInsights | null; loading: boolean; error: string | null }>({ data: null, loading: false, error: null });
  const [dashboardAiState, setDashboardAiState] = useState<{ data: AiContextInsights | null; loading: boolean; error: string | null }>({ data: null, loading: false, error: null });
  const [hotspotAiState, setHotspotAiState] = useState<{ data: AiContextInsights | null; loading: boolean; error: string | null }>({ data: null, loading: false, error: null });
  const [watchlistPreviews, setWatchlistPreviews] = useState<WatchlistPreviewMap>({});
  const [detailState, setDetailState] = useState<DetailState>({ history: [], related: [], loading: true, error: null, lastUpdated: null });
  const [snapshotState, setSnapshotState] = useState<SnapshotState>({ quote: null, history: [], loading: true, error: null, lastUpdated: null });
  const [leftPanelWidth, setLeftPanelWidth] = useState<number>(() => {
    const stored = typeof window === 'undefined' ? null : window.localStorage.getItem('stock-dashboard-left-width');
    const parsed = stored ? Number.parseInt(stored, 10) : NaN;
    return Number.isFinite(parsed) ? parsed : DEFAULT_LEFT_PANEL_WIDTH;
  });
  const [searchPanelHeight, setSearchPanelHeight] = useState<number>(() => {
    const stored = typeof window === 'undefined' ? null : window.localStorage.getItem('stock-dashboard-search-height');
    const parsed = stored ? Number.parseInt(stored, 10) : NaN;
    return Number.isFinite(parsed) ? parsed : DEFAULT_SEARCH_PANEL_HEIGHT;
  });
  const historyCacheRef = useRef<Record<string, { history: HistoryPoint[]; lastUpdated: string }>>({});
  const relatedCacheRef = useRef<Record<string, string[]>>({});
  const snapshotCacheRef = useRef<Record<string, { quote: QuoteResponse; history: HistoryPoint[]; lastUpdated: string }>>({});
  const dragModeRef = useRef<'left-panel' | 'search-panel' | null>(null);
  const watchlistPanelRef = useRef<HTMLElement | null>(null);
  const mergedWatchlist = useMemo(
    () =>
      watchlist.map((item) => ({
        ...item,
        price: quotes[item.ticker]?.price ?? 0,
        changePercent: quotes[item.ticker]?.changePercent ?? 0,
        volume: quotes[item.ticker]?.volume ?? 0,
      })),
    [quotes, watchlist],
  );
  const selectedStock = mergedWatchlist.find((item) => item.ticker === selectedTicker) ?? mergedWatchlist[0] ?? null;
  const selectedTickerSafe = selectedStock?.ticker ?? null;
  const effectiveInterval = activePeriod === '1d' ? intradayInterval : intervalByPeriod[activePeriod];
  const locale = localeByLanguage[language];
  const t = translations[language];
  const activeAiConfig = aiSettings.providers[aiSettings.activeProvider];
  const aiReady = aiSettings.enabled && activeAiConfig.apiKey.trim() && activeAiConfig.baseUrl.trim() && activeAiConfig.model.trim();
  const aiCachePrefix = `${aiSettings.activeProvider}:${activeAiConfig.model}:${language}:${getTodayCacheTag()}`;
  const trendColors = uiSettings.colorMode === 'greenUp'
    ? { up: '#3ad6a3', down: '#ff6a6a' }
    : { up: '#ff6a6a', down: '#3ad6a3' };
  const chartColors = {
    candleUp: trendColors.up,
    candleDown: trendColors.down,
    ma5: '#ffd166',
    ma10: '#7bdff2',
    ma20: '#c792ea',
    grid: '#4b5563',
  };
  const configuredProviders = (['deepseek', 'qwen', 'custom'] as AiProvider[]).filter((provider) => {
    const config = aiSettings.providers[provider];
    return isAiProviderConfigured(config);
  });
  const compactNumberFormatter = useMemo(
    () => new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 2 }),
    [locale],
  );
  const summaryDateTimeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        timeZone: CHINA_TIMEZONE,
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
    [locale],
  );
  const formatCompactNumber = (value: number) => compactNumberFormatter.format(value);
  const formatDateTime = (value: string) => summaryDateTimeFormatter.format(new Date(value));
  const formatXAxisLabel = (value: string, market: MarketType, period: PeriodKey) => new Intl.DateTimeFormat(locale, { timeZone: tz(market), year: period === '1y' ? 'numeric' : undefined, month: period === '1mo' || period === '3mo' || period === '1y' ? '2-digit' : undefined, day: period === '1mo' || period === '3mo' ? '2-digit' : period === '1y' ? undefined : '2-digit', hour: period === '1d' || period === '1wk' ? '2-digit' : undefined, minute: period === '1d' || period === '1wk' ? '2-digit' : undefined, hour12: false }).format(new Date(value));
  const formatHoverTime = (value: string, market: MarketType, period: PeriodKey) => new Intl.DateTimeFormat(locale, { timeZone: tz(market), year: period === '1y' ? 'numeric' : undefined, month: '2-digit', day: '2-digit', hour: period === '1d' || period === '1wk' ? '2-digit' : undefined, minute: period === '1d' || period === '1wk' ? '2-digit' : undefined, hour12: false }).format(new Date(value));

  useEffect(() => {
    window.localStorage.setItem('stock-dashboard-language', language);
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  }, [language]);

  useEffect(() => {
    window.localStorage.setItem('stock-dashboard-left-width', String(leftPanelWidth));
  }, [leftPanelWidth]);

  useEffect(() => {
    window.localStorage.setItem('stock-dashboard-search-height', String(searchPanelHeight));
  }, [searchPanelHeight]);

  useEffect(() => {
    window.localStorage.setItem('stock-dashboard-ai-settings', JSON.stringify(aiSettings));
  }, [aiSettings]);

  useEffect(() => {
    window.localStorage.setItem('stock-dashboard-ui-settings', JSON.stringify(uiSettings));
  }, [uiSettings]);

  useEffect(() => {
    const handlePointerMove = (event: MouseEvent) => {
      if (window.innerWidth <= 900) {
        return;
      }

      if (dragModeRef.current === 'left-panel') {
        const nextWidth = Math.min(Math.max(event.clientX, 280), Math.min(520, window.innerWidth - 420));
        setLeftPanelWidth(nextWidth);
      }

      if (dragModeRef.current === 'search-panel' && watchlistPanelRef.current) {
        const panelBounds = watchlistPanelRef.current.getBoundingClientRect();
        const relativeY = event.clientY - panelBounds.top - 128;
        const nextHeight = Math.min(Math.max(relativeY, 180), Math.max(320, panelBounds.height - 260));
        setSearchPanelHeight(nextHeight);
      }
    };

    const stopDragging = () => {
      dragModeRef.current = null;
      document.body.classList.remove('layout-resizing');
    };

    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mouseup', stopDragging);
    return () => {
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', stopDragging);
    };
  }, []);

  useEffect(() => {
    if (activeModule !== 'hot') {
      return;
    }

    let cancelled = false;
    const hotspotCacheKey = `stock-dashboard:hotspot:${hotspotMarket}`;
    const cachedData = readCachedValue<HotspotResponse>(hotspotCacheKey, HOTSPOT_CACHE_TTL_MS);
    setHotspotUsedCache(Boolean(cachedData));
    if (cachedData) {
      setHotspotState({ data: cachedData, loading: false, error: null });
    } else {
      setHotspotState((current) => ({ ...current, loading: true, error: null }));
    }
    const load = async () => {
      if (!cachedData) {
        setHotspotState((current) => ({ ...current, loading: true, error: null }));
      }
      try {
        const response = await fetch(buildApiUrl(`/market/hotspots?market=${hotspotMarket}`));
        if (!response.ok) {
          throw new Error(t.failedToLoadMarketData);
        }
        const data: HotspotResponse = await response.json();
        writeCachedValue(hotspotCacheKey, data);
        if (!cancelled) {
          setHotspotUsedCache(false);
          setHotspotState({ data, loading: false, error: null });
        }
      } catch (error) {
        if (!cancelled) {
          setHotspotState({
            data: cachedData,
            loading: false,
            error: cachedData ? null : (error instanceof Error ? error.message : t.unknownError),
          });
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [activeModule, hotspotMarket, t.failedToLoadMarketData, t.unknownError]);

  useEffect(() => {
    if (activeModule !== 'news') {
      return;
    }

    let cancelled = false;
    const newsCacheKey = 'stock-dashboard:news:ALL';
    const cachedData = readCachedValue<NewsResponse>(newsCacheKey, NEWS_CACHE_TTL_MS);
    setNewsUsedCache(Boolean(cachedData));
    if (cachedData) {
      setNewsState({ data: cachedData, loading: false, error: null });
    } else {
      setNewsState((current) => ({ ...current, loading: true, error: null }));
    }

    const load = async () => {
      if (!cachedData) {
        setNewsState((current) => ({ ...current, loading: true, error: null }));
      }
      try {
        const response = await fetch(buildApiUrl('/news?market=ALL&limit=200'));
        if (!response.ok) {
          throw new Error(t.failedToLoadMarketData);
        }
        const data: NewsResponse = await response.json();
        writeCachedValue(newsCacheKey, data);
        if (!cancelled) {
          setNewsUsedCache(false);
          setNewsState({ data, loading: false, error: null });
        }
      } catch (error) {
        if (!cancelled) {
          setNewsState({
            data: cachedData,
            loading: false,
            error: cachedData ? null : (error instanceof Error ? error.message : t.unknownError),
          });
        }
      }
    };

    void load();
    const intervalId = window.setInterval(() => {
      void load();
    }, uiSettings.newsRefreshSeconds * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeModule, t.failedToLoadMarketData, t.unknownError, uiSettings.newsRefreshSeconds]);

  useEffect(() => {
    if (activeModule !== 'news' || !newsState.data || !aiSettings.enabled || !activeAiConfig.apiKey.trim()) {
      setAiInsightsState({ data: null, loading: false, error: null });
      return;
    }

    let cancelled = false;
    const aiNewsCacheKey = `stock-dashboard:ai:news:${aiCachePrefix}:${getNewsFingerprint(newsState.data.items)}`;
    const cachedAiInsights = readCachedValue<AiNewsInsights>(aiNewsCacheKey, getMsUntilEndOfDay());
    if (cachedAiInsights) {
      setAiInsightsState({ data: cachedAiInsights, loading: false, error: null });
      return () => {
        cancelled = true;
      };
    }
    const load = async () => {
      setAiInsightsState({ data: null, loading: true, error: null });
      try {
        const response = await fetch(buildApiUrl('/news/ai-insights'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            settings: {
              provider: aiSettings.activeProvider,
              base_url: activeAiConfig.baseUrl,
              model: activeAiConfig.model,
              api_key: activeAiConfig.apiKey,
            },
            language,
            items: newsState.data?.items ?? [],
          }),
        });
        if (!response.ok) {
          throw new Error(t.aiAnalysisFailed);
        }
        const data: AiNewsInsights = await response.json();
        if (!cancelled) {
          writeCachedValue(aiNewsCacheKey, data);
          setAiInsightsState({ data, loading: false, error: null });
        }
      } catch (error) {
        if (!cancelled) {
          setAiInsightsState({
            data: null,
            loading: false,
            error: error instanceof Error ? error.message : t.aiAnalysisFailed,
          });
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [activeModule, aiCachePrefix, aiSettings, language, newsState.data, t.aiAnalysisFailed]);

  useEffect(() => {
    setDashboardAiState({ data: null, loading: false, error: null });
  }, [language, selectedTickerSafe, activePeriod, effectiveInterval]);

  useEffect(() => {
    setHotspotAiState({ data: null, loading: false, error: null });
  }, [language, hotspotMarket]);

  useEffect(() => {
    if (watchlist.length === 0) {
      setWatchlistPreviews({});
      return;
    }

    let cancelled = false;
    const load = async () => {
      const entries = await Promise.all(
        watchlist.map(async (stock) => {
          const previewCacheKey = `stock-dashboard:watchlist-preview:${stock.ticker}`;
          const cached = readCachedValue<HistoryPoint[]>(previewCacheKey, 10 * 60 * 1000);
          if (cached?.length) {
            return [stock.ticker, cached] as const;
          }
          try {
            const response = await fetch(buildApiUrl(`/stocks/${stock.ticker}/history?period=1d&interval=5m`));
            if (!response.ok) {
              return [stock.ticker, []] as const;
            }
            const data: { ticker: string; data: HistoryPoint[] } = await response.json();
            const preview = data.data.slice(-48);
            writeCachedValue(previewCacheKey, preview);
            return [stock.ticker, preview] as const;
          } catch {
            return [stock.ticker, []] as const;
          }
        }),
      );

      if (cancelled) return;
      setWatchlistPreviews(Object.fromEntries(entries));
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [watchlist]);

  useEffect(() => {
    stockWebSocketService.connect();
    const unsubscribe = useStockStore.subscribe(() => stockWebSocketService.updateSubscriptions());
    return () => { stockWebSocketService.disconnect(); unsubscribe(); };
  }, []);

  useEffect(() => { if (!selectedStock && watchlist.length > 0) selectStock(watchlist[0].ticker); }, [selectedStock, selectStock, watchlist]);

  useEffect(() => {
    if (!selectedTickerSafe) { setDetailState({ history: [], related: [], loading: false, error: t.pleaseAddStock, lastUpdated: null }); return; }
    let cancelled = false;
    const cacheKey = `${selectedTickerSafe}:${activePeriod}:${effectiveInterval}`;
    const cachedHistory = historyCacheRef.current[cacheKey];
    const cachedRelated = relatedCacheRef.current[selectedTickerSafe];
    const detailStorageKey = `stock-dashboard:detail:${cacheKey}`;
    const cachedDetail = readCachedValue<{ history: HistoryPoint[]; related: string[]; lastUpdated: string }>(detailStorageKey, DETAIL_CACHE_TTL_MS);
    if (cachedHistory) {
      setDetailState({ history: cachedHistory.history, related: cachedRelated ?? [], loading: false, error: null, lastUpdated: cachedHistory.lastUpdated });
      return () => { cancelled = true; };
    }
    if (cachedDetail) {
      historyCacheRef.current[cacheKey] = { history: cachedDetail.history, lastUpdated: cachedDetail.lastUpdated };
      relatedCacheRef.current[selectedTickerSafe] = cachedDetail.related;
      setDetailState({ history: cachedDetail.history, related: cachedDetail.related, loading: true, error: null, lastUpdated: cachedDetail.lastUpdated });
    }
    const load = async () => {
      setDetailState((current) => ({ ...current, loading: true, error: null }));
      try {
        const [historyResponse, quoteResponse, relatedResponse] = await Promise.all([fetch(buildApiUrl(`/stocks/${selectedTickerSafe}/history?period=${activePeriod}&interval=${effectiveInterval}`)), fetch(buildApiUrl(`/stocks/${selectedTickerSafe}/quote`)), cachedRelated ? Promise.resolve(null) : fetch(buildApiUrl(`/stocks/${selectedTickerSafe}/recommendations`))]);
        if (!historyResponse.ok || !quoteResponse.ok || (relatedResponse && !relatedResponse.ok)) throw new Error(t.failedToLoadMarketData);
        const historyData: { ticker: string; data: HistoryPoint[] } = await historyResponse.json();
        const quoteData: QuoteResponse = await quoteResponse.json();
        const relatedData: { recommendations: string[] } | null = relatedResponse ? await relatedResponse.json() : null;
        if (cancelled) return;
        const lastUpdated = new Date().toISOString();
        const nextRelated = relatedData?.recommendations ?? cachedRelated ?? [];
        historyCacheRef.current[cacheKey] = { history: historyData.data, lastUpdated };
        relatedCacheRef.current[selectedTickerSafe] = nextRelated;
        writeCachedValue(detailStorageKey, { history: historyData.data, related: nextRelated, lastUpdated });
        updateLiveQuote(selectedTickerSafe, { price: quoteData.price, changePercent: quoteData.change_percent, volume: quoteData.volume });
        setDetailState({ history: historyData.data, related: nextRelated, loading: false, error: null, lastUpdated });
      } catch (error) {
        if (!cancelled) setDetailState({ history: [], related: [], loading: false, error: error instanceof Error ? error.message : t.unknownError, lastUpdated: null });
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [activePeriod, effectiveInterval, selectedTickerSafe, t.failedToLoadMarketData, t.pleaseAddStock, t.unknownError, updateLiveQuote]);

  useEffect(() => {
    if (!selectedTickerSafe) { setSnapshotState({ quote: null, history: [], loading: false, error: null, lastUpdated: null }); return; }
    let cancelled = false;
    const cached = snapshotCacheRef.current[selectedTickerSafe];
    const snapshotStorageKey = `stock-dashboard:snapshot:${selectedTickerSafe}`;
    const cachedSnapshot = readCachedValue<{ quote: QuoteResponse; history: HistoryPoint[]; lastUpdated: string }>(snapshotStorageKey, SNAPSHOT_CACHE_TTL_MS);
    if (cached) {
      setSnapshotState({ quote: cached.quote, history: cached.history, loading: false, error: null, lastUpdated: cached.lastUpdated });
    } else if (cachedSnapshot) {
      snapshotCacheRef.current[selectedTickerSafe] = cachedSnapshot;
      setSnapshotState({ quote: cachedSnapshot.quote, history: cachedSnapshot.history, loading: true, error: null, lastUpdated: cachedSnapshot.lastUpdated });
    } else {
      setSnapshotState({ quote: null, history: [], loading: true, error: null, lastUpdated: null });
    }
    const load = async () => {
      try {
        const [quoteResponse, historyResponse] = await Promise.all([fetch(buildApiUrl(`/stocks/${selectedTickerSafe}/quote`)), fetch(buildApiUrl(`/stocks/${selectedTickerSafe}/history?period=1d&interval=5m`))]);
        if (!quoteResponse.ok || !historyResponse.ok) throw new Error(t.failedToLoadDailySnapshot);
        const quote: QuoteResponse = await quoteResponse.json();
        const historyData: { ticker: string; data: HistoryPoint[] } = await historyResponse.json();
        if (cancelled) return;
        const lastUpdated = new Date().toISOString();
        snapshotCacheRef.current[selectedTickerSafe] = { quote, history: historyData.data, lastUpdated };
        writeCachedValue(snapshotStorageKey, { quote, history: historyData.data, lastUpdated });
        setSnapshotState({ quote, history: historyData.data, loading: false, error: null, lastUpdated });
      } catch (error) {
        if (!cancelled) setSnapshotState((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : t.unknownError }));
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [selectedTickerSafe, t.failedToLoadDailySnapshot, t.unknownError]);
  useEffect(() => {
    if (!selectedStock || selectedStock.market !== 'US' || activePeriod !== '1d' || intradayInterval !== '15m') return;
    setDetailState((current) => {
      if (current.history.length === 0) return current;
      const nextHistory = [...current.history];
      const lastBar = nextHistory[nextHistory.length - 1];
      const barStart = new Date(lastBar.timestamp).getTime();
      const bucketMs = 15 * 60 * 1000;
      const nextBucketTime = barStart + bucketMs;
      const latestPrice = selectedStock.price;
      const latestVolume = selectedStock.volume;
      if (!Number.isFinite(latestPrice) || latestPrice <= 0) return current;
      if (Date.now() < nextBucketTime) nextHistory[nextHistory.length - 1] = { ...lastBar, high: Math.max(lastBar.high, latestPrice), low: Math.min(lastBar.low, latestPrice), close: latestPrice, volume: Math.max(lastBar.volume, latestVolume) };
      else nextHistory.push({ timestamp: new Date(nextBucketTime).toISOString(), open: lastBar.close, high: Math.max(lastBar.close, latestPrice), low: Math.min(lastBar.close, latestPrice), close: latestPrice, volume: latestVolume });
      return { ...current, history: nextHistory };
    });
  }, [activePeriod, intradayInterval, selectedStock?.market, selectedStock?.price, selectedStock?.volume]);

  useEffect(() => {
    if (!searchText.trim()) { setSearchResults([]); setSearchLoading(false); setSearchError(null); return; }
    let cancelled = false;
    setSearchLoading(true); setSearchError(null);
    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await fetch(buildApiUrl(`/stocks/search?query=${encodeURIComponent(searchText.trim())}&market=${searchMarket}`));
        if (!response.ok) throw new Error(t.searchFailed);
        const data: { results: SearchResult[] } = await response.json();
        if (!cancelled) { setSearchResults(data.results); setSearchLoading(false); }
      } catch (error) {
        if (!cancelled) { setSearchResults([]); setSearchLoading(false); setSearchError(error instanceof Error ? error.message : t.searchFailed); }
      }
    }, 260);
    return () => { cancelled = true; window.clearTimeout(timeoutId); };
  }, [searchMarket, searchText, t.searchFailed]);

  const history = detailState.history;
  const latestBar = history[history.length - 1] ?? null;
  const latestClose = latestBar?.close ?? selectedStock?.price ?? 0;
  const quote = snapshotState.quote;
  const dayHistory = snapshotState.history;
  const todayPrice = quote?.price ?? selectedStock?.price ?? latestClose;
  const historyHigh = dayHistory.length ? Math.max(...dayHistory.map((item) => item.high)) : todayPrice;
  const historyLow = dayHistory.length ? Math.min(...dayHistory.map((item) => item.low)) : todayPrice;
  const previousClose =
    quote?.previous_close ??
    (quote?.change_percent !== undefined && quote.change_percent !== null
      ? todayPrice / (1 + quote.change_percent / 100)
      : selectedStock && selectedStock.changePercent !== -100
        ? todayPrice / (1 + selectedStock.changePercent / 100)
        : todayPrice);
  const todayDelta = todayPrice - previousClose;
  const todayDeltaPercent = previousClose === 0 ? 0 : (todayDelta / previousClose) * 100;
  const dayOpen = quote?.open_price ?? dayHistory[0]?.open ?? previousClose ?? todayPrice;
  const dayHigh = Math.max(quote?.high_price ?? todayPrice, historyHigh, todayPrice);
  const dayLow = Math.min(quote?.low_price ?? todayPrice, historyLow, todayPrice);
  const dayRange = dayHigh - dayLow;
  const dayAmplitude = previousClose === 0 ? 0 : (dayRange / previousClose) * 100;
  const avgBarVolume = dayHistory.length ? dayHistory.reduce((sum, item) => sum + item.volume, 0) / dayHistory.length : selectedStock?.volume ?? quote?.volume ?? 0;
  const heroPeriodLabel = activePeriod === '1d' ? `${periodDisplayLabel[language][activePeriod]} ${intradayInterval}` : periodDisplayLabel[language][activePeriod];
  const snapshotUpdated = snapshotState.lastUpdated ?? detailState.lastUpdated;
  const summary = selectedStock ? t.summary(selectedStock.name, dayOpen.toFixed(2), dayHigh.toFixed(2), dayLow.toFixed(2), todayPrice.toFixed(2), formatCompactNumber(quote?.volume ?? selectedStock.volume)) : '';
  const infoCards = selectedStock ? [
    { title: t.open, value: `${getCurrencySymbol(selectedStock.ticker)}${dayOpen.toFixed(2)}`, hint: t.todayOpen },
    { title: t.prevClose, value: `${getCurrencySymbol(selectedStock.ticker)}${previousClose.toFixed(2)}`, hint: t.previousClose },
    { title: t.dayHigh, value: `${getCurrencySymbol(selectedStock.ticker)}${dayHigh.toFixed(2)}`, hint: t.todayHigh },
    { title: t.dayLow, value: `${getCurrencySymbol(selectedStock.ticker)}${dayLow.toFixed(2)}`, hint: t.todayLow },
    { title: t.dayRange, value: `${getCurrencySymbol(selectedStock.ticker)}${dayRange.toFixed(2)}`, hint: t.highMinusLow },
    { title: t.amplitude, value: `${dayAmplitude.toFixed(2)}%`, hint: t.vsPrevClose },
    { title: language === 'zh' ? '成交量' : 'Volume', value: formatCompactNumber(selectedStock.volume || quote?.volume || 0), hint: t.todayVolume },
    { title: t.avgBarVol, value: formatCompactNumber(avgBarVolume), hint: t.avgBarVolume },
    { title: t.turnover, value: quote?.amount ? formatCompactNumber(quote.amount) : '--', hint: t.todayAmount },
    { title: t.turnoverRate, value: quote?.turnover_rate !== null && quote?.turnover_rate !== undefined ? `${quote.turnover_rate.toFixed(2)}%` : '--', hint: t.shownWhenAvailable },
  ] : [];
  const hotspotData = hotspotState.data;
  const hotspotDisplayData = hotspotData?.market === hotspotMarket ? hotspotData : null;
  const hotspotLoading = hotspotState.loading || (hotspotData !== null && hotspotData.market !== hotspotMarket);
  const hotspotSignalLabel = hotspotMarket === 'CN' ? (language === 'zh' ? '市场活跃度' : 'Market Activity') : t.vixLabel;
  const hotspotSignalValue = hotspotMarket === 'CN' ? hotspotDisplayData?.summary.activity_ratio ?? hotspotDisplayData?.summary.vix ?? null : hotspotDisplayData?.summary.vix ?? null;
  const hotspotSignalChange = hotspotMarket === 'US' ? hotspotDisplayData?.summary.vix_change ?? null : null;
  const hotspotHeatmapDisplayRows = hotspotDisplayData?.sectors?.length ? hotspotDisplayData.sectors : hotspotDisplayData ? [...hotspotDisplayData.indices, ...hotspotDisplayData.leaders.slice(0, 4), ...hotspotDisplayData.laggards.slice(0, 4)] : [];
  const hotspotHeatmapTiles = useMemo(() => {
    if (!hotspotHeatmapDisplayRows.length) {
      return [];
    }

    const maxAbsChange = Math.max(...hotspotHeatmapDisplayRows.map((stock) => Math.abs(stock.change_percent)), 1);
    const maxVolume = Math.max(...hotspotHeatmapDisplayRows.map((stock) => stock.volume || 0), 1);
    const maxAmplitude = Math.max(...hotspotHeatmapDisplayRows.map((stock) => Math.abs(stock.amplitude_percent ?? stock.change_percent)), 1);

    const weightedTiles = hotspotHeatmapDisplayRows.map((stock) => {
      const absChange = Math.abs(stock.change_percent);
      const changeScore = clamp(absChange / maxAbsChange, 0, 1);
      const volumeScore = clamp((stock.volume || 0) / maxVolume, 0, 1);
      const amplitudeScore = clamp(Math.abs(stock.amplitude_percent ?? stock.change_percent) / maxAmplitude, 0, 1);
      const prominence = (changeScore * 0.56) + (volumeScore * 0.29) + (amplitudeScore * 0.15);
      const heat = clamp(0.22 + (prominence * 0.78), 0.24, 1);
      const sectorLabel = ('sector' in stock && stock.sector) ? stock.sector : stock.name;

      return {
        ...stock,
        sectorLabel,
        prominence,
        heat,
        weight: clamp(0.7 + (prominence * 3.8), 0.7, 4.5),
      };
    })
      .sort((left, right) => right.prominence - left.prominence)
      .slice(0, 10);

    return buildTreemapLayout(weightedTiles).map((stock) => ({
      ...stock,
      density: getHeatmapDensity(stock),
    }));
  }, [hotspotHeatmapDisplayRows]);
  const newsData = newsState.data;
  const handleDashboardAiAnalysis = async () => {
    if (!aiReady) {
      setDashboardAiState({ data: null, loading: false, error: t.aiNeedConfig });
      return;
    }
    if (!selectedStock) {
      setDashboardAiState({ data: null, loading: false, error: t.pleaseAddStock });
      return;
    }

    const dashboardAiCacheKey = `stock-dashboard:ai:dashboard:${aiCachePrefix}:${selectedStock.ticker}:${activePeriod}:${effectiveInterval}`;
    const cachedDashboardAi = readCachedValue<AiContextInsights>(dashboardAiCacheKey, getMsUntilEndOfDay());
    if (cachedDashboardAi) {
      setDashboardAiState({ data: cachedDashboardAi, loading: false, error: null });
      return;
    }

    setDashboardAiState({ data: null, loading: true, error: null });
    try {
      const response = await fetch(buildApiUrl('/ai/context-insights'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: {
            provider: aiSettings.activeProvider,
            base_url: activeAiConfig.baseUrl,
            model: activeAiConfig.model,
            api_key: activeAiConfig.apiKey,
          },
          language,
          context_type: 'dashboard',
          payload: {
            ticker: selectedStock.ticker,
            name: selectedStock.name,
            market: selectedStock.market,
            period: activePeriod,
            interval: effectiveInterval,
            hero_period: heroPeriodLabel,
            quote: {
              last: todayPrice,
              change: todayDelta,
              change_percent: todayDeltaPercent,
              open: dayOpen,
              high: dayHigh,
              low: dayLow,
              previous_close: previousClose,
              amplitude_percent: dayAmplitude,
              volume: selectedStock.volume || quote?.volume || 0,
              average_bar_volume: avgBarVolume,
              turnover: quote?.amount ?? null,
              turnover_rate: quote?.turnover_rate ?? null,
            },
            recent_history: history.slice(-36),
          },
        }),
      });
      if (!response.ok) {
        throw new Error(t.aiAnalysisFailed);
      }
      const data: AiContextInsights = await response.json();
      writeCachedValue(dashboardAiCacheKey, data);
      setDashboardAiState({ data, loading: false, error: null });
    } catch (error) {
      setDashboardAiState({ data: null, loading: false, error: error instanceof Error ? error.message : t.aiAnalysisFailed });
    }
  };
  const handleHotspotAiAnalysis = async () => {
    if (!aiReady) {
      setHotspotAiState({ data: null, loading: false, error: t.aiNeedConfig });
      return;
    }
    if (!hotspotData) {
      setHotspotAiState({ data: null, loading: false, error: t.hotspotEmpty });
      return;
    }

    const hotspotAiCacheKey = `stock-dashboard:ai:hotspot:${aiCachePrefix}:${hotspotData.market}:${hotspotData.updated_at.slice(0, 10)}`;
    const cachedHotspotAi = readCachedValue<AiContextInsights>(hotspotAiCacheKey, getMsUntilEndOfDay());
    if (cachedHotspotAi) {
      setHotspotAiState({ data: cachedHotspotAi, loading: false, error: null });
      return;
    }

    setHotspotAiState({ data: null, loading: true, error: null });
    try {
      const response = await fetch(buildApiUrl('/ai/context-insights'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: {
            provider: aiSettings.activeProvider,
            base_url: activeAiConfig.baseUrl,
            model: activeAiConfig.model,
            api_key: activeAiConfig.apiKey,
          },
          language,
          context_type: 'hotspot',
          payload: {
            market: hotspotData.market,
            updated_at: hotspotData.updated_at,
            breadth: hotspotData.breadth,
            summary: hotspotData.summary,
            indices: hotspotData.indices.slice(0, 6),
            leaders: hotspotData.leaders.slice(0, 6),
            laggards: hotspotData.laggards.slice(0, 6),
            active: hotspotData.active.slice(0, 6),
          },
        }),
      });
      if (!response.ok) {
        throw new Error(t.aiAnalysisFailed);
      }
      const data: AiContextInsights = await response.json();
      writeCachedValue(hotspotAiCacheKey, data);
      setHotspotAiState({ data, loading: false, error: null });
    } catch (error) {
      setHotspotAiState({ data: null, loading: false, error: error instanceof Error ? error.message : t.aiAnalysisFailed });
    }
  };
  const openHotspotStock = (stock: HotspotRow) => {
    addToWatchlist({
      ticker: stock.ticker,
      name: stock.name,
      market: hotspotMarket,
      price: stock.price,
      changePercent: stock.change_percent,
      volume: stock.volume,
    });
    selectStock(stock.ticker);
    setActiveModule('dashboard');
  };

  return (
    <div className="terminal-page" style={{ ['--left-panel-width' as string]: `${leftPanelWidth}px`, ['--positive' as string]: trendColors.up, ['--negative' as string]: trendColors.down }}>
      <aside className="watchlist-panel" ref={watchlistPanelRef}>
        <div className="watchlist-header"><div><h1 className="app-logo-title"><img src="/zpboard.png" alt="ZPboard" className="app-logo-mark" /><span className="app-logo-wordmark">ZPboard</span></h1></div><div className="watchlist-header-actions" /></div>
        <div className="watchlist-body">
          <div className="search-panel" style={{ ['--search-panel-height' as string]: `${searchPanelHeight}px` }}>
            <div className="market-toggle">{(['US', 'CN'] as MarketType[]).map((market) => <button key={market} type="button" className={searchMarket === market ? 'active' : ''} onClick={() => setSearchMarket(market)}>{marketLabel[market]}</button>)}</div>
            <label className="search-box"><span>{t.addStock}</span><input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder={searchMarket === 'US' ? 'AAPL / Tesla' : '600519 / Moutai'} /></label>
            <LoadingSurface loading={searchLoading} label={t.loadingTransition} className="search-results">
              {searchLoading && <p className="search-hint">{t.searching}</p>}
              {!searchLoading && searchError && <p className="search-hint search-error">{searchError}</p>}
              {!searchLoading && !searchError && !searchText.trim() && <p className="search-hint">{t.searchHint}</p>}
              {!searchLoading && !searchError && searchText.trim() && searchResults.map((result) => <button key={result.ticker} type="button" className="search-result-item" onClick={() => { addToWatchlist({ ticker: result.ticker, name: result.name, market: searchMarket, price: 0, changePercent: 0, volume: 0 }); selectStock(result.ticker); setSearchText(''); setSearchResults([]); }}><div><strong>{result.ticker}</strong><span>{result.name}</span></div><em>{t.add}</em></button>)}
            </LoadingSurface>
          </div>
          <div
            className="panel-divider panel-divider--horizontal"
            onMouseDown={() => {
              dragModeRef.current = 'search-panel';
              document.body.classList.add('layout-resizing');
            }}
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize search and watchlist panels"
          />
          <div className="watchlist-items">
          {mergedWatchlist.map((stock) => {
              const isActive = stock.ticker === selectedStock?.ticker;
              const isPositive = stock.changePercent >= 0;
              return <article key={stock.ticker} className={`watchlist-item${isActive ? ' active' : ''}`} role="button" tabIndex={0} onClick={() => selectStock(stock.ticker)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectStock(stock.ticker); } }}><div className="watchlist-main"><div className="stock-inline-head"><StockAvatar ticker={stock.ticker} name={stock.name} market={stock.market} size="md" /><div><strong>{stock.ticker}</strong><span>{stock.name}</span></div></div><span className={`badge ${stock.market === 'US' ? 'badge-us' : 'badge-cn'}`}>{marketLabel[stock.market]}</span></div><MiniTrendLine data={watchlistPreviews[stock.ticker] ?? []} latestPrice={stock.price} changePercent={stock.changePercent} /><div className="watchlist-meta"><p>{getCurrencySymbol(stock.ticker)}{stock.price.toFixed(2)}</p><span className={isPositive ? 'positive' : 'negative'}>{formatSigned(stock.changePercent)}%</span></div><div className="watchlist-footer"><small>{t.volumeShort} {formatCompactNumber(stock.volume)}</small><button type="button" className="ghost-action" onClick={(event) => { event.stopPropagation(); removeFromWatchlist(stock.ticker); }}>{t.remove}</button></div></article>;
            })}
          </div>
        </div>
      </aside>
      <div
        className="panel-divider panel-divider--vertical"
        onMouseDown={() => {
          dragModeRef.current = 'left-panel';
          document.body.classList.add('layout-resizing');
        }}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize left and right panels"
      />

      <main className="detail-panel">
        <div className="top-nav">
          <div className="top-nav-group">
            <button type="button" className={activeModule === 'dashboard' ? 'active' : ''} onClick={() => setActiveModule('dashboard')}>{t.home}</button>
            <button type="button" className={activeModule === 'hot' ? 'active' : ''} onClick={() => setActiveModule('hot')}>{t.hotspot}</button>
            <button type="button" className={activeModule === 'news' ? 'active' : ''} onClick={() => setActiveModule('news')}>{t.news}</button>
          </div>
          <div className="top-nav-actions">
            <span className="top-nav-status">{snapshotUpdated ? `${t.snapshot} ${formatDateTime(snapshotUpdated)}` : t.waitingUpdate}</span>
            <button
              type="button"
              className={`settings-trigger${aiSettings.enabled && activeAiConfig.apiKey.trim() ? ' configured' : ''}`}
              onClick={() => { setAiSettingsOpen(true); setProviderEditor(null); }}
              aria-label={t.aiSettings}
              title={t.aiSettings}
            >
              <span>⚙</span>
            </button>
          </div>
        </div>
        {activeModule === 'hot' ? (
          <section className="hotspot-panel hotspot-dashboard">
            <div className="hotspot-hero-card">
              <div className="hotspot-hero-copy">
                <div>
                  <p className="eyebrow">{t.hotspot}</p>
                  <h3>{t.hotspotTitle}</h3>
                  <p className="hero-summary">{t.hotspotHint}</p>
                </div>
                <div className="hotspot-hero-tags">
                  <div className="market-toggle hotspot-market-toggle">
                    <button type="button" className={hotspotMarket === 'US' ? 'active' : ''} onClick={() => setHotspotMarket('US')}>US</button>
                    <button type="button" className={hotspotMarket === 'CN' ? 'active' : ''} onClick={() => setHotspotMarket('CN')}>CN</button>
                  </div>
                  <button type="button" className="ai-action" onClick={() => void handleHotspotAiAnalysis()} disabled={hotspotAiState.loading}>
                    {hotspotAiState.loading ? t.aiAnalyzing : t.aiAnalyzeHotspot}
                  </button>
                  <span className="status-pill">{t.usOnly}</span>
                  <span className="status-pill">{t.marketUpdated} {hotspotDisplayData ? formatDateTime(hotspotDisplayData.updated_at) : t.waitingUpdate}</span>
                </div>
              </div>
              <div className="hotspot-radar">
                <div className="hotspot-radar-core">
                  <span>{t.marketBreadth}</span>
                  <strong>{hotspotDisplayData ? `${hotspotDisplayData.summary.breadth_ratio.toFixed(0)}%` : '--'}</strong>
                </div>
              </div>
            </div>
            {hotspotAiState.data || hotspotAiState.loading || hotspotAiState.error ? (
              <AiAnalysisCard
                title={t.aiMarketSentiment}
                data={hotspotAiState.data}
                loading={hotspotAiState.loading}
                error={hotspotAiState.error}
                sentimentLabel={t.aiSentiment}
                analyzedAtLabel={t.aiAnalyzedAt}
                signalsLabel={t.aiSignals}
                risksLabel={t.aiRisks}
                fallbackLoadingText={t.aiAnalyzing}
              />
            ) : null}
            {hotspotLoading && !hotspotDisplayData ? <div className="chart-state">{t.loadingChart}</div> : hotspotState.error && !hotspotDisplayData ? <div className="chart-state chart-error">{hotspotState.error}</div> : hotspotDisplayData ? <LoadingSurface loading={hotspotLoading} label={t.loadingTransition} className="module-loading-surface"><>
            {hotspotUsedCache ? <p className="empty-copy">{t.cacheReady}</p> : null}
            <div className="hotspot-grid">
              <article className="info-card hotspot-card hotspot-stat-card">
                <p>{t.marketSummary}</p>
                <strong>{hotspotDisplayData.breadth.total}</strong>
                <div className="hotspot-stat-cluster">
                  <span className="stat-chip stat-chip--up">▲ {t.advancers} {hotspotDisplayData.breadth.advancers}</span>
                  <span className="stat-chip stat-chip--down">▼ {t.decliners} {hotspotDisplayData.breadth.decliners}</span>
                  <span className="stat-chip">• {t.flatCount} {hotspotDisplayData.breadth.flat}</span>
                </div>
              </article>
              <article className="info-card hotspot-card hotspot-stat-card">
                <p>{t.breadthRatio}</p>
                <strong>{hotspotDisplayData.summary.breadth_ratio.toFixed(2)}%</strong>
                <div className="hotspot-stat-cluster">
                  <span className="stat-chip stat-chip--accent">◎ {t.marketIndices}</span>
                  <span>{hotspotDisplayData.indices.length}</span>
                </div>
              </article>
              <article className="info-card hotspot-card hotspot-stat-card">
                <p>{hotspotSignalLabel}</p>
                <strong>{hotspotSignalValue !== null && hotspotSignalValue !== undefined ? `${hotspotSignalValue.toFixed(2)}${hotspotMarket === 'CN' ? '%' : ''}` : '--'}</strong>
                <div className="hotspot-stat-cluster">
                  {hotspotMarket === 'CN' ? (
                    <span className="stat-chip stat-chip--accent">⏸ {t.halted} {hotspotDisplayData.summary.halted ?? 0}</span>
                  ) : (
                    <span className={`stat-chip ${(hotspotSignalChange ?? 0) >= 0 ? 'stat-chip--down' : 'stat-chip--up'}`}>
                      {hotspotSignalChange !== null && hotspotSignalChange !== undefined ? `${formatSigned(hotspotSignalChange)}%` : '--'}
                    </span>
                  )}
                </div>
              </article>
            </div>
            <div className="insight-layout hotspot-visual-layout">
              <section className="chart-card heatmap-card">
                <div className="section-header">
                  <div>
                    <h3>{t.sectorHeatmap}</h3>
                    <p>{t.marketOverview}</p>
                  </div>
                </div>
                <div className="heatmap-grid">
                  {hotspotHeatmapTiles.map((stock) => (
                    <button
                      key={stock.ticker}
                      type="button"
                      className="heatmap-tile"
                      style={{
                        ['--heat' as string]: `${stock.heat}`,
                        ['--x' as string]: stock.x,
                        ['--y' as string]: stock.y,
                        ['--w' as string]: stock.width,
                        ['--h' as string]: stock.height,
                      } as CSSProperties}
                      data-direction={stock.change_percent >= 0 ? 'up' : 'down'}
                      data-density={stock.density}
                      title={`${String(stock.sectorLabel)} · ${stock.name}`}
                      onClick={() => openHotspotStock(stock)}
                    >
                      <div className="heatmap-tile-head">
                        <StockAvatar ticker={stock.ticker} name={stock.name} market={hotspotMarket} size="sm" />
                        <strong>{stock.ticker}</strong>
                      </div>
                      <div className="heatmap-tile-body">
                        <span>{String(stock.sectorLabel)}</span>
                        <small>{stock.name}</small>
                      </div>
                      <div className="heatmap-tile-foot">
                        <em className={stock.change_percent >= 0 ? 'positive' : 'negative'}>{formatSigned(stock.change_percent)}%</em>
                        <b>{formatCompactNumber(stock.volume)}</b>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
              <section className="chart-card">
                <div className="section-header">
                  <div>
                    <h3>{t.marketBreadth}</h3>
                    <p>{t.amplitudeMap}</p>
                  </div>
                </div>
                <BreadthBar
                  advancers={hotspotDisplayData.breadth.advancers}
                  decliners={hotspotDisplayData.breadth.decliners}
                  flat={hotspotDisplayData.breadth.flat}
                  total={hotspotDisplayData.breadth.total}
                  labels={{ advancers: t.advancers, decliners: t.decliners, flat: t.flatCount }}
                />
                <div className="flow-chip">
                  <strong>{t.marketUpdated}</strong>
                  <span>{formatDateTime(hotspotDisplayData.updated_at)}</span>
                </div>
                <VolumePulseChart
                  title={t.volumePulse}
                  rows={hotspotDisplayData.active}
                  market={hotspotMarket}
                  formatCompactNumber={formatCompactNumber}
                />
              </section>
            </div>
            <div className="hotspot-board-grid">
            <section className="chart-card hotspot-table-card hotspot-table-card--indices">
              <div className="section-header">
                <div>
                  <h3>{t.marketIndices}</h3>
                  <p>{t.marketOverview}</p>
                </div>
              </div>
              <div className="hotspot-list">
                {hotspotDisplayData.indices.map((stock, index) => (
                  <HotspotBoardRow
                    key={stock.ticker}
                    stock={stock}
                    index={index}
                    variant="indices"
                    market={hotspotMarket}
                    metric={`${getCurrencySymbol(stock.ticker)}${stock.price.toFixed(2)}`}
                    onClick={() => openHotspotStock(stock)}
                  />
                ))}
                {hotspotDisplayData.indices.length === 0 && <p className="empty-copy">{t.hotspotEmpty}</p>}
              </div>
            </section>
            <div className="insight-layout hotspot-movers-grid">
              <section className="insight-card">
                <div className="section-header"><div><h3>{t.hotspotLead}</h3><p>{t.marketOverview}</p></div></div>
                <div className="hotspot-list">
                  {hotspotDisplayData.leaders.map((stock, index) => (
                    <HotspotBoardRow
                      key={stock.ticker}
                      stock={stock}
                      index={index}
                      variant="gainers"
                      market={hotspotMarket}
                      metric={`${getCurrencySymbol(stock.ticker)}${stock.price.toFixed(2)}`}
                      onClick={() => openHotspotStock(stock)}
                    />
                  ))}
                </div>
              </section>
              <section className="insight-card">
                <div className="section-header"><div><h3>{t.hotspotSwing}</h3><p>{t.marketOverview}</p></div></div>
                <div className="hotspot-list">
                  {hotspotDisplayData.laggards.map((stock, index) => (
                    <HotspotBoardRow
                      key={stock.ticker}
                      stock={stock}
                      index={index}
                      variant="losers"
                      market={hotspotMarket}
                      metric={`${getCurrencySymbol(stock.ticker)}${stock.price.toFixed(2)}`}
                      onClick={() => openHotspotStock(stock)}
                    />
                  ))}
                </div>
              </section>
            </div>
            </div>
            <section className="chart-card hotspot-table-card hotspot-table-card--active">
              <div className="section-header">
                <div>
                  <h3>{t.hotspotActive}</h3>
                  <p>{t.marketOverview}</p>
                </div>
              </div>
              <div className="hotspot-list">
                {hotspotDisplayData.active.map((stock, index) => (
                  <HotspotBoardRow
                    key={stock.ticker}
                    stock={stock}
                    index={index}
                    variant="active"
                    market={hotspotMarket}
                    metric={formatCompactNumber(stock.volume)}
                    onClick={() => openHotspotStock(stock)}
                  />
                ))}
              </div>
            </section>
            </></LoadingSurface> : <p className="empty-copy">{t.hotspotEmpty}</p>}
          </section>
        ) : activeModule === 'news' ? (
          <section className="hotspot-panel news-dashboard">
            <div className="news-hero-card">
              <div className="hotspot-hero-copy">
                <div>
                  <p className="eyebrow">{t.news}</p>
                  <h3>{t.newsTitle}</h3>
                  <p className="hero-summary">{t.newsHint}</p>
                </div>
                <div className="hotspot-hero-tags">
                  <span className="status-pill">{t.newsUpdated} {newsData ? formatDateTime(newsData.updated_at) : t.waitingUpdate}</span>
                </div>
              </div>
            </div>
            {newsState.loading && !newsData ? <div className="chart-state">{t.loadingChart}</div> : newsState.error && !newsData ? <div className="chart-state chart-error">{newsState.error}</div> : newsData ? <LoadingSurface loading={newsState.loading} label={t.loadingTransition} className="module-loading-surface"><>
              {newsUsedCache ? <p className="empty-copy">{t.cacheReady}</p> : null}
              <section className="chart-card">
                <div className="section-header">
                  <div>
                    <h3>{aiInsightsState.data ? t.aiKeywords : t.newsKeywords}</h3>
                    <p>{aiInsightsState.loading ? t.aiAnalyzing : aiInsightsState.data ? `${aiInsightsState.data.provider} · ${aiInsightsState.data.model}` : (aiSettings.enabled ? t.aiConfigured : t.aiNotConfigured)}</p>
                  </div>
                </div>
                {aiInsightsState.data ? <p className="hero-summary news-ai-summary">{aiInsightsState.data.summary}</p> : null}
                {aiInsightsState.error ? <p className="search-hint search-error">{aiInsightsState.error}</p> : null}
                <div className="news-keywords">
                  {(aiInsightsState.data?.keywords ?? newsData.keywords).map((keyword) => (
                    <span key={keyword} className="related-chip news-keyword-chip">{keyword}</span>
                  ))}
                  {(aiInsightsState.data?.keywords ?? newsData.keywords).length === 0 ? <p className="empty-copy">{t.newsEmpty}</p> : null}
                </div>
              </section>
              <div className="news-feed">
                {newsData.items.map((item, index) => (
                  <article
                    key={`${item.source}-${item.published_at}-${index}`}
                    className={`news-row${item.url ? ' news-row--clickable' : ''}`}
                    onClick={item.url ? () => window.open(item.url as string, '_blank', 'noopener,noreferrer') : undefined}
                    role={item.url ? 'link' : undefined}
                    tabIndex={item.url ? 0 : undefined}
                    onKeyDown={item.url ? (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        window.open(item.url as string, '_blank', 'noopener,noreferrer');
                      }
                    } : undefined}
                  >
                    <div className="news-row-meta">
                      <time>{formatDateTime(item.published_at)}</time>
                      <span className={`badge ${item.market === 'US' ? 'badge-us' : item.market === 'CN' ? 'badge-cn' : ''}`}>{item.source}</span>
                    </div>
                    <h4 className="news-row-title">{item.title}</h4>
                  </article>
                ))}
              </div>
              {newsData.items.length === 0 ? <p className="empty-copy">{t.newsEmpty}</p> : null}
            </></LoadingSurface> : <p className="empty-copy">{t.newsEmpty}</p>}
          </section>
        ) : selectedStock ? <>
          <section className="hero-card"><div className="hero-topline"><div><p className="eyebrow">{t.dailySnapshot}</p><h2>{selectedStock.name}<span>{selectedStock.ticker}</span></h2></div><div className="hero-tags"><button type="button" className="ai-action" onClick={() => void handleDashboardAiAnalysis()} disabled={dashboardAiState.loading}>{dashboardAiState.loading ? t.aiAnalyzing : t.aiAnalyzeDashboard}</button><span>{marketLabel[selectedStock.market]}</span><span>{heroPeriodLabel}</span><span>{snapshotUpdated ? `${t.snapshot} ${formatDateTime(snapshotUpdated)}` : t.waitingUpdate}</span></div></div><div className="hero-metrics"><div><p className="metric-label">{t.last}</p><strong>{getCurrencySymbol(selectedStock.ticker)}{todayPrice.toFixed(2)}</strong></div><div><p className="metric-label">{t.change}</p><strong className={todayDeltaPercent >= 0 ? 'positive' : 'negative'}>{formatSigned(todayDelta)} / {formatSigned(todayDeltaPercent)}%</strong></div><div><p className="metric-label">{t.amplitude}</p><strong>{dayAmplitude.toFixed(2)}%</strong></div></div><p className="hero-summary">{snapshotState.error ? snapshotState.error : summary}</p></section>
          <section className="chart-card"><div className="section-header"><div><h3>{t.candlestick}</h3><p>{t.chartHint}</p></div><div className="chart-controls"><div className="period-switcher">{periodOptions.map((option) => <button key={option.key} type="button" className={activePeriod === option.key ? 'active' : ''} onClick={() => setActivePeriod(option.key)}>{option.key === '1d' ? periodDisplayLabel[language][option.key] : option.label}</button>)}</div>{activePeriod === '1d' && <div className="period-switcher">{intradayIntervalOptions.map((option) => <button key={option.key} type="button" className={intradayInterval === option.key ? 'active' : ''} onClick={() => setIntradayInterval(option.key)}>{option.label}</button>)}</div>}</div></div><LoadingSurface loading={detailState.loading && history.length > 0} label={t.loadingTransition}>{detailState.loading && history.length === 0 ? <div className="chart-state">{t.loadingChart}</div> : detailState.error ? <div className="chart-state chart-error">{detailState.error}</div> : <CandleChart data={history} ticker={selectedStock.ticker} market={selectedStock.market} period={activePeriod} interval={effectiveInterval} language={language} formatCompactNumber={formatCompactNumber} formatHoverTime={formatHoverTime} formatXAxisLabel={formatXAxisLabel} chartColors={chartColors} />}</LoadingSurface></section>
          {dashboardAiState.data || dashboardAiState.loading || dashboardAiState.error ? <AiAnalysisCard title={t.aiProfessionalView} data={dashboardAiState.data} loading={dashboardAiState.loading} error={dashboardAiState.error} sentimentLabel={t.aiSentiment} analyzedAtLabel={t.aiAnalyzedAt} signalsLabel={t.aiSignals} risksLabel={t.aiRisks} fallbackLoadingText={t.aiAnalyzing} /> : null}
          <section className="info-grid">{infoCards.map((item) => <InfoCard key={item.title} title={item.title} value={item.value} hint={item.hint} />)}</section>
          <section className="insight-layout"><div className="insight-card"><div className="section-header"><div><h3>{t.sessionNotes}</h3><p>{t.sessionHint}</p></div></div><ul className="insight-list"><li>{t.notes.line1(dayOpen.toFixed(2), dayHigh.toFixed(2), dayLow.toFixed(2), todayPrice.toFixed(2))}</li><li>{t.notes.line2(dayRange.toFixed(2), dayAmplitude.toFixed(2))}</li><li>{t.notes.line3(formatCompactNumber(selectedStock.volume || quote?.volume || 0), formatCompactNumber(avgBarVolume))}</li></ul></div><div className="insight-card"><div className="section-header"><div><h3>{t.related}</h3><p>{t.relatedHint}</p></div></div><div className="related-list">{detailState.related.length > 0 ? detailState.related.map((ticker) => <button key={ticker} type="button" className="related-chip" onClick={() => { const existing = watchlist.find((item) => item.ticker === ticker); if (existing) { selectStock(existing.ticker); return; } addToWatchlist({ ticker, name: ticker, market: ticker.length === 6 && !Number.isNaN(Number(ticker)) ? 'CN' : 'US', price: 0, changePercent: 0, volume: 0 }); selectStock(ticker); }}>{ticker}</button>) : <p className="empty-copy">{t.noRelated}</p>}</div></div></section>
        </> : <section className="empty-state">{t.emptyWatchlist}</section>}
        {aiSettingsOpen ? (
          <div className="settings-overlay" onClick={() => setAiSettingsOpen(false)}>
            <div className="settings-modal" onClick={(event) => event.stopPropagation()}>
              <div className="settings-shell">
                <aside className="settings-sidebar">
                  <div className="settings-sidebar-head">
                    <h3>{t.settingsTitle}</h3>
                    <p>{t.settingsHint}</p>
                  </div>
                  <div className="settings-nav">
                    <button type="button" className={settingsSection === 'general' ? 'active' : ''} onClick={() => setSettingsSection('general')}>{t.generalSettings}</button>
                    <button type="button" className={settingsSection === 'chart' ? 'active' : ''} onClick={() => setSettingsSection('chart')}>{t.chartSettings}</button>
                    <button type="button" className={settingsSection === 'ai' ? 'active' : ''} onClick={() => setSettingsSection('ai')}>{t.aiSettings}</button>
                  </div>
                </aside>
                <section className="settings-content">
                  {settingsSection === 'general' ? (
                    <>
                      <div className="section-header">
                        <div>
                          <h3>{t.generalSettings}</h3>
                          <p>{t.settingsHint}</p>
                        </div>
                      </div>
                      <label className="settings-field">
                        <span>{t.languageSetting}</span>
                        <div className="settings-segmented">
                          <button type="button" className={language === 'zh' ? 'active' : ''} onClick={() => setLanguage('zh')}>中文</button>
                          <button type="button" className={language === 'en' ? 'active' : ''} onClick={() => setLanguage('en')}>English</button>
                        </div>
                      </label>
                      <label className="settings-field">
                        <span>{t.newsRefresh}</span>
                        <select value={uiSettings.newsRefreshSeconds} onChange={(event) => setUiSettings((current) => ({ ...current, newsRefreshSeconds: Number(event.target.value) as UiSettings['newsRefreshSeconds'] }))}>
                          <option value={30}>{t.refresh30s}</option>
                          <option value={60}>{t.refresh60s}</option>
                          <option value={120}>{t.refresh120s}</option>
                        </select>
                      </label>
                    </>
                  ) : null}

                  {settingsSection === 'chart' ? (
                    <>
                      <div className="section-header">
                        <div>
                          <h3>{t.chartSettings}</h3>
                          <p>{t.chartColorPreset}</p>
                        </div>
                      </div>
                      <label className="settings-field">
                        <span>{t.colorModeSetting}</span>
                        <div className="settings-segmented">
                          <button type="button" className={uiSettings.colorMode === 'greenUp' ? 'active' : ''} onClick={() => setUiSettings((current) => ({ ...current, colorMode: 'greenUp' }))}>{t.greenUpMode}</button>
                          <button type="button" className={uiSettings.colorMode === 'greenDown' ? 'active' : ''} onClick={() => setUiSettings((current) => ({ ...current, colorMode: 'greenDown' }))}>{t.greenDownMode}</button>
                        </div>
                      </label>
                    </>
                  ) : null}

                  {settingsSection === 'ai' ? (
                    <>
                      <div className="section-header">
                        <div>
                          <h3>{t.aiSettings}</h3>
                          <p>{t.savedProviders}</p>
                        </div>
                      </div>
                      <label className="settings-field settings-inline">
                        <span>{t.aiEnable}</span>
                        <input
                          type="checkbox"
                          checked={aiSettings.enabled}
                          onChange={(event) => setAiSettings((current) => ({ ...current, enabled: event.target.checked }))}
                        />
                      </label>
                      <label className="settings-field">
                        <span>{t.activeAiProvider}</span>
                        {configuredProviders.length > 0 ? (
                          <div className="settings-segmented">
                            {configuredProviders.map((provider) => (
                              <button key={provider} type="button" className={aiSettings.activeProvider === provider ? 'active' : ''} onClick={() => setAiSettings((current) => ({ ...current, activeProvider: provider }))}>
                                {provider === 'deepseek' ? 'DeepSeek' : provider === 'qwen' ? 'Qwen' : 'Custom'}
                              </button>
                            ))}
                          </div>
                        ) : <p className="empty-copy">{t.aiSavedEmpty}</p>}
                      </label>
                      <div className="settings-provider-toolbar">
                        <button
                          type="button"
                          className="settings-add-provider"
                          onClick={() => {
                            const nextProvider = (['deepseek', 'qwen', 'custom'] as AiProvider[]).find((provider) => !configuredProviders.includes(provider)) ?? 'custom';
                            setProviderEditor({ mode: 'create', provider: nextProvider });
                          }}
                        >
                          + {t.aiAddProvider}
                        </button>
                      </div>
                      <div className="settings-provider-list">
                        {configuredProviders.length === 0 ? <p className="empty-copy">{t.aiSavedEmpty}</p> : null}
                        {configuredProviders.map((provider) => (
                          <div key={provider} className={`settings-provider-row${aiSettings.activeProvider === provider ? ' active' : ''}`}>
                            <div className="settings-provider-summary">
                              <strong>{provider === 'deepseek' ? 'DeepSeek' : provider === 'qwen' ? 'Qwen' : 'Custom'}</strong>
                              <span>{aiSettings.providers[provider].model || t.aiProviderMissing}</span>
                            </div>
                            <div className="settings-provider-actions">
                              <span className={`settings-provider-status${isAiProviderConfigured(aiSettings.providers[provider]) ? ' ready' : ''}`}>{isAiProviderConfigured(aiSettings.providers[provider]) ? t.aiProviderReady : t.aiProviderMissing}</span>
                              <button type="button" className={`settings-provider-toggle${aiSettings.activeProvider === provider ? ' active' : ''}`} onClick={() => setAiSettings((current) => ({ ...current, activeProvider: provider }))}>
                                {aiSettings.activeProvider === provider ? t.aiConfigured : t.aiUseThis}
                              </button>
                              <button type="button" className="settings-provider-edit" onClick={() => setProviderEditor({ mode: 'edit', provider })}>{t.aiEditProvider}</button>
                            </div>
                          </div>
                        ))}
                      </div>
                      {providerEditor ? (
                        <div className="settings-provider-card active">
                          <div className="settings-provider-head">
                            <strong>{providerEditor.provider === 'deepseek' ? 'DeepSeek' : providerEditor.provider === 'qwen' ? 'Qwen' : 'Custom'}</strong>
                            <button type="button" className="settings-provider-edit" onClick={() => setProviderEditor(null)}>{t.aiSave}</button>
                          </div>
                          <label className="settings-field">
                            <span>{t.aiBaseUrl}</span>
                            <input value={aiSettings.providers[providerEditor.provider].baseUrl} onChange={(event) => setAiSettings((current) => ({ ...current, providers: { ...current.providers, [providerEditor.provider]: { ...current.providers[providerEditor.provider], baseUrl: event.target.value } } }))} placeholder="https://api.deepseek.com" />
                          </label>
                          <label className="settings-field">
                            <span>{t.aiModel}</span>
                            <input value={aiSettings.providers[providerEditor.provider].model} onChange={(event) => setAiSettings((current) => ({ ...current, providers: { ...current.providers, [providerEditor.provider]: { ...current.providers[providerEditor.provider], model: event.target.value } } }))} placeholder="deepseek-chat / qwen-plus" />
                          </label>
                          <label className="settings-field">
                            <span>{t.aiApiKey}</span>
                            <input type="password" value={aiSettings.providers[providerEditor.provider].apiKey} onChange={(event) => setAiSettings((current) => ({ ...current, providers: { ...current.providers, [providerEditor.provider]: { ...current.providers[providerEditor.provider], apiKey: event.target.value } } }))} placeholder="sk-..." />
                          </label>
                        </div>
                      ) : null}
                    </>
                  ) : null}

                  <div className="settings-actions">
                    <button type="button" className="settings-save" onClick={() => setAiSettingsOpen(false)}>{t.aiSave}</button>
                  </div>
                </section>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}

function InfoCard({ title, value, hint }: { title: string; value: string; hint: string }) {
  return <article className="info-card"><p>{title}</p><strong>{value}</strong><span>{hint}</span></article>;
}

function LoadingSurface({
  loading,
  label,
  className,
  children,
}: {
  loading: boolean;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`loading-surface${className ? ` ${className}` : ''}`} aria-busy={loading}>
      {children}
      {loading ? <LoadingOverlay label={label} /> : null}
    </div>
  );
}

function AiAnalysisCard({
  title,
  data,
  loading,
  error,
  sentimentLabel,
  analyzedAtLabel,
  signalsLabel,
  risksLabel,
  fallbackLoadingText,
}: {
  title: string;
  data: AiContextInsights | null;
  loading: boolean;
  error: string | null;
  sentimentLabel: string;
  analyzedAtLabel: string;
  signalsLabel: string;
  risksLabel: string;
  fallbackLoadingText: string;
}) {
  return (
    <section className="chart-card ai-analysis-card">
      <div className="section-header">
        <div>
          <h3>{data?.title ?? title}</h3>
          <p>{loading ? fallbackLoadingText : data ? `${data.provider} · ${data.model}` : title}</p>
        </div>
        {data ? <span className="status-pill ai-analysis-pill">{sentimentLabel} · {data.sentiment}</span> : null}
      </div>
      {loading ? <p className="hero-summary news-ai-summary">{fallbackLoadingText}</p> : null}
      {error ? <p className="search-hint search-error">{error}</p> : null}
      {data ? (
        <>
          <p className="hero-summary news-ai-summary">{data.summary}</p>
          <div className="ai-analysis-meta">
            <span className="status-pill">{analyzedAtLabel} {new Intl.DateTimeFormat(data.language.startsWith('zh') ? 'zh-CN' : 'en-US', { timeZone: CHINA_TIMEZONE, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(data.analyzed_at))}</span>
          </div>
          <div className="ai-analysis-grid">
            <div className="insight-card ai-analysis-subcard">
              <div className="section-header"><div><h3>{signalsLabel}</h3></div></div>
              <ul className="insight-list">
                {data.signals.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
            <div className="insight-card ai-analysis-subcard">
              <div className="section-header"><div><h3>{risksLabel}</h3></div></div>
              <ul className="insight-list">
                {data.risks.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}

function LoadingOverlay({ label }: { label: string }) {
  return (
    <div className="loading-overlay" role="status" aria-live="polite">
      <div className="loading-overlay__shimmer" />
      <div className="loading-overlay__content">
        <span className="loading-overlay__spinner" />
        <strong>{label}</strong>
      </div>
    </div>
  );
}

function BreadthBar({
  advancers,
  decliners,
  flat,
  total,
  labels,
}: {
  advancers: number;
  decliners: number;
  flat: number;
  total: number;
  labels: { advancers: string; decliners: string; flat: string };
}) {
  const safeTotal = Math.max(total, 1);
  const advancerWidth = `${(advancers / safeTotal) * 100}%`;
  const declinerWidth = `${(decliners / safeTotal) * 100}%`;
  const flatWidth = `${(flat / safeTotal) * 100}%`;

  return (
    <div className="breadth-card">
      <div className="breadth-bar">
        <span className="breadth-up" style={{ width: advancerWidth }} />
        <span className="breadth-flat" style={{ width: flatWidth }} />
        <span className="breadth-down" style={{ width: declinerWidth }} />
      </div>
      <div className="breadth-legend">
        <span><i className="legend-up" />{labels.advancers} {advancers}</span>
        <span><i className="legend-flat" />{labels.flat} {flat}</span>
        <span><i className="legend-down" />{labels.decliners} {decliners}</span>
      </div>
    </div>
  );
}

function VolumePulseChart({
  title,
  rows,
  market,
  formatCompactNumber,
}: {
  title: string;
  rows: HotspotRow[];
  market: MarketType;
  formatCompactNumber: (value: number) => string;
}) {
  const maxVolume = Math.max(...rows.map((row) => row.volume), 1);

  return (
    <div className="pulse-card">
      <p className="pulse-title">{title}</p>
      <div className="pulse-list">
        {rows.map((row) => (
          <div key={row.ticker} className="pulse-row">
            <div className="pulse-meta">
              <div className="stock-inline-head">
                <StockAvatar ticker={row.ticker} name={row.name} market={market} size="xs" />
                <strong>{row.ticker}</strong>
              </div>
              <span>{formatCompactNumber(row.volume)}</span>
            </div>
            <div className="pulse-track">
              <span className="pulse-fill" style={{ width: `${(row.volume / maxVolume) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HotspotBoardRow({
  stock,
  index,
  variant,
  market,
  metric,
  onClick,
}: {
  stock: HotspotRow;
  index: number;
  variant: 'indices' | 'gainers' | 'losers' | 'active';
  market: MarketType;
  metric: string;
  onClick: () => void;
}) {
  const iconByVariant = {
    indices: '◎',
    gainers: '▲',
    losers: '▼',
    active: '◉',
  } as const;

  return (
    <button
      type="button"
      className={`hotspot-row hotspot-row--${variant}`}
      onClick={onClick}
      title={`${stock.ticker} ${stock.name}`}
    >
      <span className={`hotspot-icon hotspot-icon--${variant}`}>{iconByVariant[variant]}</span>
      <span className="hotspot-rank">{String(index + 1).padStart(2, '0')}</span>
      <div className="hotspot-symbol-block">
        <div className="stock-inline-head">
          <StockAvatar ticker={stock.ticker} name={stock.name} market={market} size="sm" />
          <strong>{stock.ticker}</strong>
        </div>
        <span className="hotspot-name" title={stock.name}>{stock.name}</span>
      </div>
      <span className="hotspot-metric" title={metric}>{metric}</span>
      <span
        className={`hotspot-change ${stock.change_percent >= 0 ? 'positive' : 'negative'}`}
        title={`${formatSigned(stock.change_percent)}%`}
      >
        {formatSigned(stock.change_percent)}%
      </span>
    </button>
  );
}

function StockAvatar({
  ticker,
  name,
  market,
  size = 'sm',
}: {
  ticker: string;
  name: string;
  market?: MarketType;
  size?: 'xs' | 'sm' | 'md';
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const visual = getStockVisual(ticker, name, market);
  const glyph = ticker.slice(0, 2).toUpperCase();

  return (
    <span className={`stock-avatar stock-avatar--${size} stock-avatar--${visual.tone}`} aria-hidden="true">
      {!imageFailed && visual.logoUrl ? (
        <img src={visual.logoUrl} alt="" loading="lazy" onError={() => setImageFailed(true)} />
      ) : (
        <span>{visual.glyph ?? glyph}</span>
      )}
    </span>
  );
}

function MiniTrendLine({
  data,
  latestPrice,
  changePercent,
}: {
  data: HistoryPoint[];
  latestPrice: number;
  changePercent: number;
}) {
  const points = data.length > 1 ? data.slice(-24).map((item) => item.close) : (latestPrice > 0 ? [latestPrice] : []);
  const toneClass = changePercent >= 0 ? 'positive' : 'negative';

  if (points.length < 2) {
    return <div className={`mini-trend mini-trend--placeholder ${toneClass}`} />;
  }

  const width = 132;
  const height = 34;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = Math.max(max - min, 1);
  const step = width / Math.max(points.length - 1, 1);
  const path = points.map((value, index) => {
    const x = index * step;
    const y = height - ((value - min) / range) * (height - 4) - 2;
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ');

  return (
    <div className="mini-trend">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <path d={path} className={`mini-trend-line ${toneClass}`} />
      </svg>
    </div>
  );
}

function CandleChart({ data, ticker, market, period, interval, language, formatCompactNumber, formatHoverTime, formatXAxisLabel, chartColors }: { data: HistoryPoint[]; ticker: string; market: MarketType; period: PeriodKey; interval: string; language: Language; formatCompactNumber: (value: number) => string; formatHoverTime: (value: string, market: MarketType, period: PeriodKey) => string; formatXAxisLabel: (value: string, market: MarketType, period: PeriodKey) => string; chartColors: { candleUp: string; candleDown: string; ma5: string; ma10: string; ma20: string; grid: string } }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; index: number } | null>(null);
  const tooltipFrameRef = useRef<number | null>(null);
  const t = translations[language];
  if (data.length === 0) return <div className="chart-state">{t.noCandlestickData}</div>;
  const width = 1000; const height = 420; const paddingX = 32; const paddingY = 24;
  const floor = Math.min(...data.map((item) => item.low));
  const ceiling = Math.max(...data.map((item) => item.high));
  const range = Math.max(ceiling - floor, 1);
  const innerWidth = width - paddingX * 2; const innerHeight = height - paddingY * 2;
  const step = innerWidth / data.length;
  const candleWidthFactor = period === '1y' ? 0.92 : period === '3mo' || period === '1mo' ? 0.82 : period === '1wk' ? 0.68 : 0.56;
  const candleWidth = Math.max(6, step * candleWidthFactor);
  const hoveredBar = hoveredIndex === null ? data[data.length - 1] : data[hoveredIndex];
  const axisIndexes = Array.from(new Set([0, Math.floor(data.length * 0.25), Math.floor(data.length * 0.5), Math.floor(data.length * 0.75), data.length - 1])).filter((index) => index >= 0 && index < data.length);
  const ma5 = ma(data, 5); const ma10 = ma(data, 10); const ma20 = ma(data, 20);
  const getY = (value: number) => paddingY + ((ceiling - value) / range) * innerHeight;
  const buildMaPath = (points: Array<{ timestamp: string; value: number } | null>) => points.reduce((path, point, index) => {
    if (!point) return path;
    const x = paddingX + step * index + step / 2; const y = getY(point.value);
    return `${path}${path ? ' L' : 'M'} ${x} ${y}`;
  }, '');

  return (
    <div
      className="candle-chart"
      style={{
        ['--candle-up' as string]: chartColors.candleUp,
        ['--candle-down' as string]: chartColors.candleDown,
        ['--ma5-color' as string]: chartColors.ma5,
        ['--ma10-color' as string]: chartColors.ma10,
        ['--ma20-color' as string]: chartColors.ma20,
        ['--grid-color' as string]: chartColors.grid,
      }}
      onMouseLeave={() => { setHoveredIndex(null); setTooltip(null); if (tooltipFrameRef.current !== null) { cancelAnimationFrame(tooltipFrameRef.current); tooltipFrameRef.current = null; } }}
    >
      <div className="chart-overlay"><div><p>{ticker}</p><strong>{hoveredBar.close.toFixed(2)}</strong></div><div className={hoveredBar.close >= hoveredBar.open ? 'positive' : 'negative'}>{formatSigned(hoveredBar.close - hoveredBar.open)} ({formatSigned(((hoveredBar.close - hoveredBar.open) / hoveredBar.open) * 100)}%)</div><span>{formatHoverTime(hoveredBar.timestamp, market, period)}</span></div>
      <div className="chart-stats"><span>{t.open} {hoveredBar.open.toFixed(2)}</span><span>{t.dayHigh} {hoveredBar.high.toFixed(2)}</span><span>{t.dayLow} {hoveredBar.low.toFixed(2)}</span><span>{t.close} {hoveredBar.close.toFixed(2)}</span><span>{t.volumeShort} {formatCompactNumber(hoveredBar.volume)}</span>{period === '1d' && <span>{t.range} {interval}</span>}</div>
      <div className="ma-legend"><span className="ma-chip ma-chip-5">MA5</span><span className="ma-chip ma-chip-10">MA10</span><span className="ma-chip ma-chip-20">MA20</span></div>
      {tooltip && data[tooltip.index] && <div className="chart-tooltip" style={{ left: tooltip.x, top: tooltip.y }}><strong>{ticker}</strong><span>{formatHoverTime(data[tooltip.index].timestamp, market, period)}</span><span>{t.open} {data[tooltip.index].open.toFixed(2)}</span><span>{t.dayHigh} {data[tooltip.index].high.toFixed(2)}</span><span>{t.dayLow} {data[tooltip.index].low.toFixed(2)}</span><span>{t.close} {data[tooltip.index].close.toFixed(2)}</span><span>{t.volumeShort} {formatCompactNumber(data[tooltip.index].volume)}</span></div>}
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t.chartAria(ticker)}>
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => { const value = floor + (1 - tick) * range; const y = paddingY + tick * innerHeight; return <g key={tick}><line x1={paddingX} y1={y} x2={width - paddingX} y2={y} className="grid-line" /><text x={width - paddingX + 8} y={y + 4} className="axis-label">{value.toFixed(2)}</text></g>; })}
        {data.map((point, index) => {
          const x = paddingX + step * index + step / 2; const openY = getY(point.open); const closeY = getY(point.close); const highY = getY(point.high); const lowY = getY(point.low); const rising = point.close >= point.open; const candleTop = Math.min(openY, closeY); const candleHeight = Math.max(Math.abs(closeY - openY), 2);
          return <g key={`${point.timestamp}-${index}`} onPointerEnter={() => setHoveredIndex(index)} onPointerMove={(event) => { const bounds = event.currentTarget.ownerSVGElement?.getBoundingClientRect(); if (!bounds) return; if (tooltipFrameRef.current !== null) cancelAnimationFrame(tooltipFrameRef.current); const nextTooltip = { index, x: event.clientX - bounds.left + 14, y: event.clientY - bounds.top - 18 }; tooltipFrameRef.current = requestAnimationFrame(() => { setHoveredIndex(index); setTooltip(nextTooltip); tooltipFrameRef.current = null; }); }}><rect x={x - step / 2} y={paddingY} width={step} height={innerHeight} className="hover-zone" /><line x1={x} y1={highY} x2={x} y2={lowY} className={rising ? 'wick-up' : 'wick-down'} /><rect x={x - candleWidth / 2} y={candleTop} width={candleWidth} height={candleHeight} rx="3" className={rising ? 'candle-up' : 'candle-down'} /></g>;
        })}
        <path d={buildMaPath(ma5)} className="ma-line ma-line-5" />
        <path d={buildMaPath(ma10)} className="ma-line ma-line-10" />
        <path d={buildMaPath(ma20)} className="ma-line ma-line-20" />
        {axisIndexes.map((index) => { const x = paddingX + step * index + step / 2; const point = data[index]; return <text key={`x-axis-${point.timestamp}`} x={x} y={height - 6} textAnchor="middle" className="axis-label">{formatXAxisLabel(point.timestamp, market, period)}</text>; })}
      </svg>
      <div className="chart-footer"><span>{t.sessionLabel(market, period)}</span><span>{t.xAxisTimezone(market)}</span></div>
    </div>
  );
}

export default App;
