import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plotAnalysis } from '../src/ai/plotAnalysis.ts';

const bars = Array.from({ length: 6 }, (_, index) => ({
  timestamp: new Date(Date.UTC(2026, 9, 28 + index)).toISOString(),
  low: 100 + index * 5,
}));
const anchor = (index, price) => ({ timestamp: bars[index].timestamp, price });
const result = {
  data: bars,
  annotations: [{ id: 'early', kind: 'support', ...anchor(0, 100) }, { id: 'late', kind: 'support', ...anchor(4, 120) }],
  trendlines: [{ id: 'support', kind: 'support', start: anchor(0, 100), end: anchor(4, 120) }],
};

test('a rolled chart clips the trend to known bars and keeps original anchor metadata', () => {
  const { chartAnnotations, trendlines } = plotAnalysis(result, bars.slice(1, 4));
  assert.deepEqual(chartAnnotations, []);
  assert.deepEqual(trendlines, [{
    ...result.trendlines[0], startIndex: 0, endIndex: 2, clippedStartPrice: 105, clippedEndPrice: 115,
  }]);
  const rolled = plotAnalysis(result, bars.slice(2));
  assert.equal(rolled.trendlines[0].clippedStartPrice, 110);
  assert.deepEqual(rolled.chartAnnotations, [{ ...result.annotations[1], index: 2, ordinal: 1 }]);
});

test('revised anchor prices and adjustment changes suppress old plots', () => {
  const revised = bars.map((bar, index) => index === 4 ? { ...bar, low: 115 } : bar);
  const plot = plotAnalysis(result, revised);
  assert.deepEqual(plot.chartAnnotations.map(point => point.id), ['early']);
  assert.deepEqual(plot.trendlines, []);
  const changedBasis = plotAnalysis({ ...result, context: { adjustment: 'qfq' } }, bars, { adjustment: 'none' });
  assert.deepEqual(changedBasis, { chartAnnotations: [], trendlines: [] });
});

test('expired trends and missing anchors inside the visible range are not projected', () => {
  assert.deepEqual(plotAnalysis(result, bars.slice(4)).trendlines, []);
  assert.deepEqual(plotAnalysis(result, [...bars.slice(0, 4), bars[5]]).trendlines, []);
  const unrelatedBoundary = { timestamp: '2026-10-28T12:00:00Z' };
  assert.deepEqual(plotAnalysis(result, [unrelatedBoundary, ...bars.slice(1)]).trendlines, []);
});
