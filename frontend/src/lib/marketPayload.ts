import type { NewsResponse, Quote } from '../terminal/types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isText = (value: unknown) => typeof value === 'string';
const isDate = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const optional = (value: unknown, check: (value: unknown) => boolean) => value == null || check(value);
const numericFields = (row: Record<string, unknown>, keys: string[]) => keys.every(key => optional(row[key], isNumber));
const list = (value: unknown, check: (value: unknown) => boolean) => Array.isArray(value) && value.every(check);

export function isNewsResponse(value: unknown): value is NewsResponse {
  return isRecord(value) && isText(value.market) && isDate(value.updated_at) &&
    (value.stale === undefined || typeof value.stale === 'boolean') && list(value.keywords, isText) &&
    list(value.items, item => isRecord(item) && isText(item.title) && isText(item.summary) &&
      isDate(item.published_at) && isText(item.source) && isText(item.market) && optional(item.url, isText) &&
      optional(item.id,isText)&&optional(item.language,isText)&&optional(item.topic,isText)&&optional(item.tickers,rows=>list(rows,isText))) &&
    optional(value.sources,rows=>list(rows,row=>isRecord(row)&&isText(row.name)&&isText(row.language)&&
      ['live','cached','unavailable'].includes(String(row.status))&&isCount(row.item_count)&&optional(row.updated_at,isDate)));
}

function isPriceRow(value: unknown): value is Record<string, unknown> & { price: number } {
  return isRecord(value) && typeof value.ticker === 'string' && value.ticker.length > 0 &&
    isNumber(value.price) && isNumber(value.change_percent) && isNumber(value.volume) && value.volume >= 0;
}

function isBookLevel(value: unknown) {
  return isRecord(value) && isNumber(value.level) && isNumber(value.price) && isNumber(value.volume);
}

export function isMarketQuote(value: unknown): value is Quote {
  return isPriceRow(value) && value.price > 0 &&
    numericFields(value, ['change', 'open_price', 'high_price', 'low_price', 'previous_close', 'amount',
      'turnover_rate', 'volume_ratio', 'pe_ratio', 'pb_ratio', 'market_cap', 'amplitude_percent']) &&
    ['name', 'source', 'delay_note'].every(key => optional(value[key], isText)) &&
    optional(value.as_of, isDate) && optional(value.fetched_at, isDate) &&
    (value.stale === undefined || typeof value.stale === 'boolean') &&
    (value.order_book == null || (isRecord(value.order_book) &&
      list(value.order_book.bids, isBookLevel) && list(value.order_book.asks, isBookLevel)));
}

function isRankRow(value: unknown): value is Record<string, unknown> {
  return isPriceRow(value) && isText(value.name) && optional(value.sector, isText) &&
    numericFields(value, ['amount', 'change', 'turnover_rate', 'volume_ratio', 'amplitude_percent']);
}

function isBoardRow(value: unknown) {
  return isRankRow(value) && optional(value.leader_name, isText) &&
    numericFields(value, ['advancers', 'decliners', 'flat', 'leader_change']);
}

function isMemberRow(value: unknown) {
  return isRecord(value) && isText(value.ticker) && value.ticker.length > 0 && isText(value.name) &&
    (value.price === null || (isNumber(value.price) && value.price > 0)) &&
    (value.change_percent === null || isNumber(value.change_percent)) &&
    (value.volume === null || (isNumber(value.volume) && value.volume >= 0)) &&
    numericFields(value, ['amount', 'change', 'turnover_rate', 'volume_ratio', 'amplitude_percent']);
}

const isCount = (value: unknown) => isNumber(value) && Number.isInteger(value) && value >= 0;
const isPositiveCount = (value: unknown) => isNumber(value) && Number.isInteger(value) && value > 0;

export function isMarketPayload(path: string, data: unknown): boolean {
  const endpoint = path.split('?')[0];
  if (endpoint === '/market/quotes') {
    return isRecord(data) && Array.isArray(data.quotes) && list(data.unavailable, isText);
  }
  if (endpoint === '/market/cn/indices') {
    return isRecord(data) && Array.isArray(data.rows) && data.rows.length > 0 &&
      data.rows.every(row => isMarketQuote(row) && isText(row.name));
  }
  if (endpoint === '/market/cn/boards' || /^\/market\/cn\/boards\/[^/]+\/members$/.test(endpoint)) {
    return isRecord(data) && list(data.rows, endpoint.endsWith('/members') ? isMemberRow : isBoardRow) && isCount(data.total) &&
      isPositiveCount(data.page) && isPositiveCount(data.page_size) && isText(data.source) && isDate(data.updated_at);
  }
  if (endpoint === '/market/hotspots') {
    return isRecord(data) && isRecord(data.breadth) && isRecord(data.summary) &&
      isCount(data.breadth.total) && isCount(data.breadth.advancers) &&
      isCount(data.breadth.decliners) && isCount(data.breadth.flat) &&
      isText(data.summary.mode) && isNumber(data.summary.breadth_ratio) && isDate(data.updated_at) &&
      ['indices', 'leaders', 'laggards', 'active'].every(key => list(data[key], isRankRow)) &&
      optional(data.sectors, rows => list(rows, isRankRow));
  }
  return true;
}
