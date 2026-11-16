import type { PortfolioOrder, PortfolioReview } from './portfolio';
export type OrderFilter = { query: string; side: 'all' | 'buy' | 'sell'; status: 'all' | 'filled' | 'rejected' };
const normalized = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase();
export function filterPortfolioOrders(orders: PortfolioOrder[], filter: OrderFilter) {
  const query = normalized(filter.query);
  return orders.filter(order => (filter.side === 'all' || order.side === filter.side) && (filter.status === 'all' || order.status === filter.status) &&
    (!query || normalized([order.id,order.ticker,order.strategy,order.reason].join(' ')).includes(query))).slice().reverse();
}
export function filterPortfolioReviews(reviews: PortfolioReview[], text: string) {
  const query = normalized(text);
  return reviews.filter(review => !query || normalized([review.ticker,review.strategy,review.decision.method,review.decision.summary,
    ...review.decision.targets.flatMap(target => [target.ticker,target.reason])].join(' ')).includes(query)).slice().reverse();
}
export function portfolioOrdersCsv(orders: PortfolioOrder[]) {
  const cell = (value: string | number) => {
    let text = String(value); if (typeof value === 'string' && /^\s*[=+@-]/.test(text)) text = "'" + text;
    return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"','""') + '"' : text;
  };
  const rows = orders.map(order => [order.id,order.time,order.ticker,order.side,order.quantity,order.fill?.price??'',order.fill?.fee??'',order.strategy??'',order.status,order.reason].map(cell).join(','));
  return '\uFEFFid,time,ticker,side,quantity,fill_price,fee,strategy,status,reason\r\n' + rows.join('\r\n') + '\r\n';
}
