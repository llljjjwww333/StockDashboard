import type { HistoryPoint, HistoryResponse } from '../terminal/types';
import type { AnalysisResult, Annotation, PlottedAnnotation, PlottedTrendline, Trendline } from './types';

const indexByTimestamp = (data: HistoryPoint[]) =>
  new Map(data.map((bar, index) => [Date.parse(bar.timestamp), index]));

function matchesAnchor(bar: HistoryPoint, kind: Annotation['kind'], price: number) {
  const value = kind === 'support' ? bar.low : kind === 'resistance' ? bar.high : bar.close;
  return Math.abs(value - price) <= Math.abs(price) * 1e-9;
}

export function plotAnalysis(result: AnalysisResult | null, data: HistoryPoint[], history?: HistoryResponse | null) {
  const chartAnnotations: PlottedAnnotation[] = [];
  const trendlines: PlottedTrendline[] = [];
  if (!result || !data.length) return { chartAnnotations, trendlines };
  const context = result.context;
  if (history && context && (
    (history.price_type && context.price_type && history.price_type !== context.price_type) ||
    (history.adjustment && context.adjustment && history.adjustment !== context.adjustment)
  )) return { chartAnnotations, trendlines };

  const visible = indexByTimestamp(data);
  result.annotations.forEach((point, ordinal) => {
    const index = visible.get(Date.parse(point.timestamp));
    if (index !== undefined && matchesAnchor(data[index], point.kind, point.price)) {
      chartAnnotations.push({ ...point, index, ordinal, timestamp: data[index].timestamp });
    }
  });

  const analysis = indexByTimestamp(result.data);
  const firstTime = Date.parse(data[0].timestamp);
  const lastIndex = data.length - 1;
  const lastTime = Date.parse(data[lastIndex].timestamp);
  const priceAt = (line: Trendline, time: number) => {
    const start = analysis.get(Date.parse(line.start.timestamp));
    const end = analysis.get(Date.parse(line.end.timestamp));
    const at = analysis.get(time);
    if (start === undefined || end === undefined || at === undefined || start >= end || at < start || at > end) return undefined;
    return line.start.price + (line.end.price - line.start.price) * (at - start) / (end - start);
  };

  for (const line of result.trendlines ?? []) {
    const startTime = Date.parse(line.start.timestamp), endTime = Date.parse(line.end.timestamp);
    const startIndex = visible.get(startTime);
    const endIndex = visible.get(endTime);
    if ((startIndex !== undefined && !matchesAnchor(data[startIndex], line.kind, line.start.price)) ||
        (endIndex !== undefined && !matchesAnchor(data[endIndex], line.kind, line.end.price))) continue;
    const clippedStartPrice = startIndex === undefined && startTime < firstTime ? priceAt(line, firstTime) : undefined;
    const clippedEndPrice = endIndex === undefined && endTime > lastTime ? priceAt(line, lastTime) : undefined;
    if ((startIndex === undefined && clippedStartPrice === undefined) || (endIndex === undefined && clippedEndPrice === undefined)) continue;
    const from = startIndex ?? 0, to = endIndex ?? lastIndex;
    if (from < to) trendlines.push({ ...line, startIndex: from, endIndex: to, clippedStartPrice, clippedEndPrice });
  }
  return { chartAnnotations, trendlines };
}
