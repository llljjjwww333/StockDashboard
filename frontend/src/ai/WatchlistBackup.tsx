import { useEffect, useRef, useState } from 'react';
import { t } from '../lib/i18n';
import { exportWatchlist, parseWatchlistBackup, watchlistBackupMaxBytes, type BackupStock } from '../lib/watchlistBackup';
import { useStockStore } from '../store/stockStore';

export function WatchlistBackup() {
  const watchlist = useStockStore(state => state.watchlist);
  const [preview, setPreview] = useState<{ filename: string; stocks: BackupStock[]; duplicates: number } | null>(null);
  const [reading, setReading] = useState(false);
  const [message, setMessage] = useState<{ key: string; count?: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);
  useEffect(() => () => { requestId.current++; }, []);
  const additions = preview?.stocks.filter(stock => !watchlist.some(current => current.ticker === stock.ticker)) ?? [];

  const readBackup = async (file: File) => {
    const id = ++requestId.current;
    setPreview(null);
    setMessage(null);
    setReading(true);
    try {
      if (file.size > watchlistBackupMaxBytes) throw new Error('备份文件不能超过 2 MB');
      const parsed = parseWatchlistBackup(await file.text());
      if (requestId.current === id) setPreview({ ...parsed, filename: file.name });
    } catch (error) {
      if (requestId.current === id) setMessage({ key: error instanceof Error ? error.message : '无法读取备份文件' });
    } finally {
      if (requestId.current === id) setReading(false);
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([exportWatchlist(watchlist)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'zpboard-watchlist.json';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage({ key: '已开始下载自选备份' });
  };

  return <div className="watchlist-backup">
    <h3>{t('自选备份')}</h3>
    <p>{t('导出自选股，在其他浏览器导入。备份仅包含股票代码、名称和市场。')}</p>
    <p>{t('当前有 {count} 只自选股', { count: watchlist.length })}</p>
    <div className="backup-actions">
      <button type="button" disabled={!watchlist.length} onClick={download}>{t('导出自选')}</button>
      <button type="button" onClick={() => fileInput.current?.click()}>{t('选择备份文件')}</button>
      <input ref={fileInput} type="file" accept=".json,application/json" aria-label={t('选择备份文件')} hidden
        onChange={event => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) void readBackup(file);
        }} />
    </div>
    {reading && <p role="status">{t('正在读取备份')}</p>}
    {preview && <div className="backup-preview">
      <h4>{t('导入预览')}</h4>
      <small>{preview.filename}</small>
      <p>{t('新增 {count} 只自选股', { count: additions.length })}</p>
      <p>{t('跳过 {count} 个重复标的', { count: preview.stocks.length - additions.length + preview.duplicates })}</p>
      <p>{t('导入只补充新股票，保留现有自选和排列顺序。')}</p>
      <ul aria-label={t('待导入自选股')}>
        {additions.slice(0, 20).map(stock => <li key={stock.ticker}><strong>{stock.ticker}</strong> <span>{stock.name}</span></li>)}
      </ul>
      {additions.length > 20 && <p>{t('另有 {count} 只股票', { count: additions.length - 20 })}</p>}
      {!additions.length && <p>{t('所有标的已在自选中')}</p>}
      <div className="backup-actions">
        <button type="button" className="ai-run" disabled={!additions.length} onClick={() => {
          const current = useStockStore.getState();
          const count = preview.stocks.filter(stock => !current.watchlist.some(item => item.ticker === stock.ticker)).length;
          current.importWatchlist(preview.stocks);
          setMessage({ key: '已导入 {count} 只自选股', count });
          setPreview(null);
        }}>{t('确认导入')}</button>
        <button type="button" onClick={() => { setPreview(null); setMessage(null); }}>{t('取消')}</button>
      </div>
    </div>}
    {message && <p role="status" className="settings-status">{t(message.key, { count: message.count ?? 0 })}</p>}
  </div>;
}
