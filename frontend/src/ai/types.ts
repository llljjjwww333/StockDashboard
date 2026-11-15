import type { HistoryPoint, HistoryResponse, NewsItem, PeriodKey } from '../terminal/types';
import type { MarketType } from '../store/stockStore';

export type AiProfile = {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  protocol: 'chat' | 'anthropic';
  rememberKey: boolean;
  updatedAt: number;
};

export type Annotation = {
  id: string;
  index: number;
  timestamp: string;
  price: number;
  kind: 'support' | 'resistance' | 'volume' | 'breakout' | 'reversal';
  label: string;
  detail: string;
};
export type PlottedAnnotation = Annotation & { ordinal: number };

export type TrendAnchor = { timestamp: string; price: number };
export type Trendline = {
  id: string;
  kind: 'support' | 'resistance';
  start: TrendAnchor;
  end: TrendAnchor;
  label: string;
  detail: string;
};
export type PlottedTrendline = Trendline & { startIndex: number; endIndex: number; clippedStartPrice?: number; clippedEndPrice?: number };

export type AnalysisRequest = {
  language?: 'zh' | 'en';
  scope: 'chart' | 'news';
  ticker?: string;
  market: MarketType;
  period?: PeriodKey;
  interval?: string;
  chart_type?: 'line' | 'candles';
  chart_history?: Pick<HistoryResponse, 'data' | 'source' | 'price_type' | 'adjustment' | 'stale'> & {
    indicators?: Record<string, number | null>;
  };
  query?: string;
  news_source?: string;
  news_items?: NewsItem[];
};

export type AnalysisResult = {
  scope: string;
  ticker: string;
  period: string;
  interval: string;
  provider: string;
  model: string;
  analyzed_at: string;
  summary: string;
  outlook: string;
  drivers: string[];
  watch: string[];
  annotations: Annotation[];
  trendlines?: Trendline[];
  data: HistoryPoint[];
  context: {
    bar_count: number;
    news_count: number;
    source?: string;
    price_type?: string | null;
    adjustment?: string | null;
    as_of?: string;
    news_sources: string[];
    indicators: Record<string, number | null>;
    news: Array<{ title: string; source: string; url?: string }>;
  };
};
