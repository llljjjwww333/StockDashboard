import { useState } from 'react';
import { t } from '../lib/i18n';
import { formatTradingFee, formatTradingPrice, formatTradingQuantity } from '../lib/tradingNumber';
import type { ClosedTrade, StrategyTrade } from './backtest';

type Props = { ticker: string; locale: string; trades?: StrategyTrade[]; closed?: ClosedTrade[] };
const day = (value: string) => value.slice(0, 10);
const reasons = { signal: '策略信号', stop: '收盘止损', profit: '收盘止盈', end: '期末清仓' };

export function StrategyTradeLedger({ ticker, locale, trades, closed }: Props) {
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(50);
  const count = (trades ?? closed ?? []).length, pages = Math.max(1, Math.ceil(count / pageSize));
  const current = Math.min(page, pages), start = (current - 1) * pageSize;
  const money = (value: number) => value.toLocaleString(locale, { maximumFractionDigits: 2 });
  return <section className="strategy-ledger" aria-label={t(trades ? '交易记录' : '交易分析')}>
    <div className="strategy-ledger-controls" aria-label={t('交易记录分页')}>
      <span role="status">{count ? `${start + 1}–${Math.min(start + pageSize, count)} / ${count}` : '0 / 0'}</span>
      <label>{t('每页')}<select aria-label={t('每页记录数')} value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}>
        {[25,50,100].map(size => <option key={size} value={size}>{size}</option>)}</select></label>
      <button type="button" aria-label={t('上一页交易')} disabled={current === 1} onClick={() => setPage(current - 1)}>{t('上一页')}</button>
      <span>{current} / {pages}</span>
      <button type="button" aria-label={t('下一页交易')} disabled={current === pages} onClick={() => setPage(current + 1)}>{t('下一页')}</button>
    </div>
    <div className="strategy-table" tabIndex={0}>
      {trades ? <table><thead><tr>{['信号日期','成交日期','方向','成交价','数量','费用','现金','原因'].map(label => <th key={label}>{t(label)}</th>)}</tr></thead>
        <tbody>{trades.slice(start,start + pageSize).map((trade,index) => <tr key={start + index}>
          <td>{day(trade.signalDate)}</td><td>{day(trade.date)}</td><td>{t(trade.side === 'buy' ? '买入' : '卖出')}</td>
          <td>{formatTradingPrice(ticker,trade.price,locale)}</td><td>{formatTradingQuantity(trade.shares,locale)}</td>
          <td>{formatTradingFee(ticker,trade.fee,locale)}</td><td>{money(trade.cash)}</td><td>{trade.detail ?? t(reasons[trade.reason])}</td>
        </tr>)}</tbody></table> : <table><thead><tr>{['开仓日期','平仓日期','持有日','净盈亏','净收益率','费用','退出原因'].map(label => <th key={label}>{t(label)}</th>)}</tr></thead>
        <tbody>{closed!.slice(start,start + pageSize).map((trade,index) => <tr key={start + index}><td>{day(trade.entryDate)}</td><td>{day(trade.exitDate)}</td>
          <td>{trade.sessions}</td><td>{money(trade.pnl)}</td><td>{(trade.returnPct * 100).toFixed(2)}%</td><td>{formatTradingFee(ticker,trade.fees,locale)}</td><td>{t(reasons[trade.reason])}</td>
        </tr>)}</tbody></table>}
      {!count && <p role="status">{t(trades ? '暂无成交' : '暂无已平仓交易')}</p>}
    </div>
  </section>;
}
