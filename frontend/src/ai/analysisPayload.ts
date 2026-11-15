import type { AnalysisRequest, AnalysisResult } from './types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value: unknown) => typeof value === 'string';
const isDate = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const isNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
const list = (value: unknown, check: (item: unknown) => boolean) => Array.isArray(value) && value.every(check);
const hasText = (item: Record<string, unknown>, fields: string[]) => fields.every(field => isText(item[field]));

function isAnchor(item: unknown) {
  return isRecord(item) && isDate(item.timestamp) && isNumber(item.price);
}

function isAnnotation(item: unknown) {
  return isRecord(item) && hasText(item, ['id', 'label', 'detail']) && Number.isInteger(item.index) &&
    isAnchor(item) && ['support', 'resistance', 'volume', 'breakout', 'reversal'].some(kind => item.kind === kind);
}

function isTrendline(item: unknown) {
  return isRecord(item) && hasText(item, ['id', 'label', 'detail']) &&
    (item.kind === 'support' || item.kind === 'resistance') && isAnchor(item.start) && isAnchor(item.end);
}

function isBar(item: unknown) {
  return isRecord(item) && isDate(item.timestamp) &&
    ['open', 'high', 'low', 'close', 'volume'].every(field => isNumber(item[field])) &&
    (item.average_price == null || isNumber(item.average_price));
}

export function isAnalysisResult(value: unknown, request: AnalysisRequest): value is AnalysisResult {
  return isRecord(value) && value.scope === request.scope &&
    hasText(value, ['ticker', 'period', 'interval', 'provider', 'model', 'summary', 'outlook']) &&
    (request.scope !== 'chart' || (value.ticker === request.ticker?.toUpperCase() &&
      value.period === (request.period ?? '1mo') && value.interval === (request.interval ?? '1d'))) &&
    isDate(value.analyzed_at) && list(value.drivers, isText) && list(value.watch, isText) &&
    list(value.annotations, isAnnotation) && (value.trendlines === undefined || list(value.trendlines, isTrendline)) &&
    list(value.data, isBar) && isRecord(value.context) &&
    Number.isInteger(value.context.bar_count) && Number.isInteger(value.context.news_count);
}
