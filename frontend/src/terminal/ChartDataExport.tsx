import { useState } from 'react';
import { t } from '../lib/i18n';
import { chartCsv } from '../lib/chartCsv';
import { downloadFile } from '../lib/downloadFile';
import type { HistoryResponse } from './types';
import { isCryptoTicker } from '../lib/instrumentIdentity';

export function ChartDataExport({ ticker, period, interval, history }: {
  ticker: string; period: string; interval: string; history: HistoryResponse | null;
}) {
  const key = `${ticker}:${period}:${interval}`;
  const [message, setMessage] = useState<{ key: string; count: number; error?: boolean } | null>(null);
  const count = history?.data.length ?? 0;
  const download = () => {
    if (!history?.data.length) return;
    try {
      downloadFile(chartCsv(ticker, period, interval, history), `${ticker}-${period}-${interval}.csv`, 'text/csv;charset=utf-8');
      setMessage({ key, count });
    } catch { setMessage({ key, count: 0, error: true }); }

  };
  return <div className="chart-data-export">
    <small>{t('当前周期 {count} 条', { count })}</small>
    {message?.key === key && <small role="status">{t(message.error ? '导出失败，请重试' : '已开始下载 {count} 条行情', { count: message.count })}</small>}
    <button type="button" disabled={!count} title={isCryptoTicker(ticker)?'导出完整行情，UTC时间，成交量使用基础币数量。':t('导出所选时间范围的全部行情，成交量使用股数。')} onClick={download}>{t('导出 CSV')}</button>
  </div>;
}
