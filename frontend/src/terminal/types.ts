import type { MarketType } from '../store/stockStore';

export type DeskView = 'overview' | 'markets' | 'news';
export type PeriodKey = '1d' | '5d' | '1mo' | '3mo' | '1y';

export type HistoryPoint = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  average_price?: number | null;
};

export type HistoryResponse = {
  data: HistoryPoint[]; source?: string; stale?: boolean; interval?: string;
  reference_price?: number | null; price_type?: string; adjustment?: string;
};

export type Quote = {
  ticker: string;
  name?: string | null;
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
  volume_ratio?: number | null;
  pe_ratio?: number | null;
  pb_ratio?: number | null;
  market_cap?: number | null;
  amplitude_percent?: number | null;
  source?: string | null;
  as_of?: string | null;
  fetched_at?: string | null;
  stale?: boolean;
  delay_note?: string | null;
  order_book?: { bids: BookLevel[]; asks: BookLevel[] } | null;
};
export type BookLevel = { level: number; price: number; volume: number };

export type SearchResult = { ticker: string; name: string };

export type HotspotRow = {
  ticker: string;
  name: string;
  price: number;
  change_percent: number;
  change?: number | null;
  volume: number;
  amount?: number | null;
  turnover_rate?: number | null;
  volume_ratio?: number | null;
  amplitude_percent?: number | null;
  sector?: string;
};

export type ChinaIndex = Quote & { name: string };
export type ChinaBoard = HotspotRow & {
  advancers?: number | null; decliners?: number | null; flat?: number | null;
  leader_name?: string | null; leader_change?: number | null;
};
export type ChinaBoardPage = {
  rows: ChinaBoard[]; total: number; page: number; page_size: number; source: string; updated_at: string; stale?: boolean;
};
export type ChinaBoardView = {
  category: 'industry' | 'concept';
  sort: 'strong' | 'weak' | 'amount';
  page: number;
  query: string;
  selection: { board: ChinaBoard; page: number } | null;
};

export type HotspotResponse = {
  market: MarketType;
  indices: HotspotRow[];
  sectors?: HotspotRow[];
  leaders: HotspotRow[];
  laggards: HotspotRow[];
  active: HotspotRow[];
  breadth: { advancers: number; decliners: number; flat: number; total: number };
  summary: {
    market: MarketType;
    mode: string;
    breadth_ratio: number;
    vix?: number | null;
    vix_change?: number | null;
    activity_ratio?: number | null;
    main_flow_net?: number | null;
    limit_up?: number | null;
    limit_down?: number | null;
  };
  updated_at: string;
  source?: string;
  stale?: boolean;
  refreshing?: boolean;
};

export type NewsItem = {
  title: string;
  summary: string;
  published_at: string;
  source: string;
  url?: string | null;
  market: string;
};

export type NewsResponse = { market: string; updated_at: string; keywords: string[]; items: NewsItem[] };
export type Loadable<T> = { data: T | null; loading: boolean; error: string | null };

export const periodOptions: Array<{ key: PeriodKey; label: string; interval: string }> = [
  { key: '1d', label: '分时', interval: '1m' },
  { key: '5d', label: '五日', interval: '1m' },
  { key: '1mo', label: '1月', interval: '1d' },
  { key: '3mo', label: '3月', interval: '1d' },
  { key: '1y', label: '1年', interval: '1d' },
];
