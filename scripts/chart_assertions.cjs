// Check the real canvas series count exposed by the engine adapter, not SVG internals.
const readyCandles = '.professional-chart[data-candle-count]:not([data-candle-count="0"])';
async function candleCount(page) {
  if (!(await page.locator('.professional-chart').count())) return 0;
  return Number(await page.locator('.professional-chart').getAttribute('data-candle-count').catch(() => 0));
}
module.exports = { readyCandles, candleCount };
