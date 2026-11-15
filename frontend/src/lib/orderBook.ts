import type { BookLevel } from '../terminal/types';

export function bookStatistics(bids: BookLevel[], asks: BookLevel[]) {
  const bidTotal = bids.reduce((total, row) => total + row.volume, 0);
  const askTotal = asks.reduce((total, row) => total + row.volume, 0);
  const bestBid = bids.find(row => row.level === 1), bestAsk = asks.find(row => row.level === 1);
  return {
    peak: Math.max(0, ...bids.map(row => row.volume), ...asks.map(row => row.volume)),
    bidShare: bidTotal + askTotal > 0 ? bidTotal / (bidTotal + askTotal) * 100 : 0,
    spread: bestBid && bestAsk ? bestAsk.price - bestBid.price : null,
  };
}
