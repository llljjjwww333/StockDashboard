import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { getLocale, t } from '../lib/i18n';
import { pricePrecision } from '../lib/pricePrecision';
import { buildChartLayout } from './chartLayout';
import { seriesPath } from './indicators';
import { StockTags } from './StockTags';
import { ResourceError } from './ResourceError';
import { changeTone, changeDirection } from '../lib/changePresentation';
import type { ChinaBoard, ChinaBoardMember, ChinaBoardPage, ChinaBoardView, ChinaIndex, HistoryResponse, HotspotResponse, HotspotRow } from './types';
import { formatCompact, formatSigned, useChinaBoardMembers, useChinaBoardPage, useChinaIndices, useChinaIndexTrend } from './useTerminalData';
import './chinaMarkets.css';

const amount = (value?: number | null) => value == null ? '—' : `¥${formatCompact(value)}`;
const tone = (value: number | null) => value == null ? '' : changeTone(value);
const shanghaiClock = (value: string) => new Intl.DateTimeFormat(getLocale(), {
  timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(new Date(value));
const count = (value: number) => value.toLocaleString(getLocale());
const percent = (value: number | null) => value == null ? '—' : `${formatSigned(value)}%`;

function IndexTrend({ history }: { history: HistoryResponse | null }) {
  const points = history?.data ?? [];
  if (points.length < 2) return null;
  const reference = history?.reference_price ?? points[0].close;
  const closes = points.map(point => point.close);
  const low = Math.min(reference, ...closes), high = Math.max(reference, ...closes);
  const pad = Math.max((high - low) * .1, high * .0005);
  const y = (price: number) => 4 + (high + pad - price) / (high - low + pad * 2) * 70;
  const layout = buildChartLayout(points, 'SH000001', true, 4, 332);
  return <svg className={`cn-index-trend ${tone(closes[closes.length - 1] - reference)}`} viewBox="0 0 336 80" preserveAspectRatio="none"
    role="img" aria-label={t('上证指数分时')}>
    <line x1="4" y1={y(reference)} x2="332" y2={y(reference)} />
    <path d={seriesPath(closes, index => layout.positions[index], y, layout.breaks)} />
    <circle cx={layout.positions.at(-1)} cy={y(closes[closes.length - 1])} r="2.8" />
  </svg>;
}

function IndexCard({ row, history, onSelect }: { row: ChinaIndex; history?: HistoryResponse | null; onSelect: (row: HotspotRow, anchor: HTMLButtonElement) => void }) {
  const featured = row.ticker === 'SH000001';
  return <button type="button" id={`market-index-${row.ticker}`} data-market-ticker={row.ticker}
    className={`cn-index-card${featured ? ' featured' : ''}`} onClick={event => onSelect(row, event.currentTarget)}>
    <span className="cn-index-name"><b>{t(row.name)}</b><small>{row.ticker}</small></span>
    <span className="cn-index-value"><strong>{row.price.toLocaleString(getLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
      <span className={tone(row.change_percent)}>{percent(row.change_percent)}</span></span>
    {featured && <><IndexTrend history={history ?? null} />
      <span className="cn-index-range"><span>{t('最低')} <b>{row.low_price?.toFixed(2) ?? '—'}</b></span>
        <span>{t('最高')} <b>{row.high_price?.toFixed(2) ?? '—'}</b></span></span></>}
  </button>;
}

function BreadthMeter({ up, flat, down }: { up?: number | null; flat?: number | null; down?: number | null }) {
  if (up == null || flat == null || down == null) return null;
  const total = Math.max(up + flat + down, 1);
  return <div className="cn-breadth">
    <div className="cn-breadth-labels"><span className="positive">{t('上涨')} <b>{count(up)}</b></span>
      <span>{t('平盘')} <b>{count(flat)}</b></span><span className="negative">{t('下跌')} <b>{count(down)}</b></span></div>
    <div className="cn-breadth-meter" aria-hidden="true"><i style={{ flexGrow: up / total }} /><i style={{ flexGrow: flat / total }} /><i style={{ flexGrow: down / total }} /></div>
  </div>;
}

function StockRows({ rows, onSelect, group, offset = 0 }: {
  rows: ChinaBoardMember[]; onSelect: (row: ChinaBoardMember, anchor: HTMLButtonElement) => void; group: string; offset?: number;
}) {
  return <div className="cn-stock-rows">{rows.map((row, index) => (
    <button type="button" key={row.ticker} id={`market-${group}-${row.ticker}`} data-market-ticker={row.ticker}
      onClick={event => onSelect(row, event.currentTarget)}>
      <span className="cn-row-rank">{String(offset + index + 1).padStart(2, '0')}</span>
      <span className="cn-row-identity"><b>{row.name}</b><small>{row.ticker} <StockTags ticker={row.ticker} name={row.name} /></small></span>
      <span className="cn-row-value"><b>{row.price === null ? '—' : row.price.toFixed(pricePrecision(row.ticker, row.price))}</b><small>{row.amount == null ? '—' : amount(row.amount)}</small></span>
      <span className={`cn-row-change ${tone(row.change_percent)}`}>{percent(row.change_percent)}</span>
    </button>
  ))}</div>;
}

const lastPage = (data: Pick<ChinaBoardPage, 'total' | 'page_size'>) => Math.max(1, Math.ceil(data.total / data.page_size));

function Pager({ data, label, onPage }: { data: ChinaBoardPage<unknown>; label: string; onPage: (page: number) => void }) {
  const last = lastPage(data);
  if (last <= 1) return null;
  return <nav className="cn-pager" aria-label={label}>
    <button type="button" disabled={data.page <= 1} onClick={() => onPage(data.page - 1)} aria-label={t('上一页')}>‹</button>
    <select aria-label={t('页码')} value={data.page} onChange={event => onPage(Number(event.target.value))}>
      {Array.from({ length: last }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}
    </select><span>/ {last}</span>
    <button type="button" disabled={data.page >= last} onClick={() => onPage(data.page + 1)} aria-label={t('下一页')}>›</button>
  </nav>;
}

const categories = [{ id: 'industry', label: '行业' }, { id: 'concept', label: '概念' }] as const;
const sorts = [{ id: 'strong', label: '涨幅' }, { id: 'weak', label: '跌幅' }, { id: 'amount', label: '成交额' }] as const;
const ranks = [{ id: 'leaders', label: '领涨' }, { id: 'laggards', label: '领跌' }, { id: 'active', label: '成交额' }] as const;
const normalizeBoardQuery = (query: string) => query.normalize('NFKC').trim();

function BoardPulse({ onSelect, view, onViewChange }: {
  onSelect: (row: ChinaBoardMember, anchor: HTMLButtonElement, fromBoard?: boolean) => void;
  view: ChinaBoardView;
  onViewChange: (view: ChinaBoardView) => void;
}) {
  const { category, sort, memberSort = 'strong', page, query, selection } = view;
  const search = normalizeBoardQuery(query);
  const [draft, setDraft] = useState<string | null>(null);
  const [debounced, setDebounced] = useState(search);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const update = (changes: Partial<ChinaBoardView>) => onViewChange({ ...view, ...changes });
  const updateQuery = (value: string) => {
    if (normalizeBoardQuery(value) === search) update({ query: value });
    else update({ query: value, page: 1, selection: null });
  };
  const focusRef = useRef<HTMLElement>(null);
  const { data, error, loading, retry } = useChinaBoardPage(category, sort, page, debounced, search === debounced);
  const pageKey = `${category}:${sort}:${page}:${search}`;
  const [defaultBoard, setDefaultBoard] = useState<{ pageKey: string; board: ChinaBoard } | null>(null);
  const firstBoard = data?.rows[0];
  if (!selection && firstBoard && defaultBoard?.pageKey !== pageKey) setDefaultBoard({ pageKey, board: firstBoard });
  const selectedBoard = selection?.board ?? (defaultBoard?.pageKey === pageKey ? defaultBoard.board : firstBoard);
  const selectedTicker = selectedBoard?.ticker ?? '';
  const liveBoard = data?.rows.find(row => row.ticker === selectedTicker);
  const focused = useChinaBoardPage(category, 'strong', 1, selectedTicker, Boolean(selectedTicker && !liveBoard && (data || error)));
  const focusedBoard = focused.data?.rows.find(row => row.ticker === selectedTicker);
  const board = liveBoard ?? focusedBoard ?? selectedBoard;
  const boardStale = liveBoard ? data?.stale : focusedBoard ? focused.data?.stale : Boolean(board);
  const keepSelection = selection && board ? { ...selection, board } : null;
  const heatMax = Math.max(1, ...(data?.rows.map(row => Math.abs(row.change_percent)) ?? []));
  const memberPage = selection?.page ?? 1;
  const members = useChinaBoardMembers(board?.ticker ?? null, memberPage, memberSort);
  const availablePage = data && !data.stale ? Math.min(page, lastPage(data)) : page;
  const availableMemberPage = members.data && !members.data.stale ? Math.min(memberPage, lastPage(members.data)) : memberPage;
  useEffect(() => {
    if (availablePage === page && availableMemberPage === memberPage) return;
    onViewChange({ ...view, page: availablePage, selection: selection ? { ...selection, page: availableMemberPage } : null });
  }, [availablePage, availableMemberPage, page, memberPage, view, selection, onViewChange]);
  return <div className="cn-board-layout" data-filtered={Boolean(search)} aria-busy={loading || focused.loading || members.loading}>
    <section className="surface cn-board-pulse">
      <header className="cn-section-header"><h2>{t('板块脉搏')}</h2>
        <div className="cn-segments" role="group" aria-label={t('板块类型')}>
          {categories.map(item => <button key={item.id} type="button" aria-pressed={item.id === category} onClick={() => { if (item.id !== category) update({ category: item.id, page: 1, selection: null }); }}>{t(item.label)}</button>)}
        </div>
      </header>
      <div className="cn-board-toolbar">
        <div className="cn-board-searchbox">
          <input className="cn-board-search" type="search" maxLength={40} aria-label={t('搜索板块')} placeholder={t('搜索板块')}
            value={draft ?? query} onChange={event => {
              if (draft === null) updateQuery(event.target.value);
              else setDraft(event.target.value);
            }} onCompositionStart={() => setDraft(query)} onCompositionEnd={event => {
              setDraft(null);
              updateQuery(event.currentTarget.value);
            }} onBlur={() => setDraft(null)} />
          {(draft ?? query) && <button type="button" aria-label={t('清除板块搜索')} onClick={() => { setDraft(null); updateQuery(''); }}>×</button>}
        </div>
        <span>{data ? `${count(data.total)} ${t('个板块')}` : '—'}{data?.stale && ` · ${t('缓存')}`}</span>
        <div className="cn-segments quiet" role="group" aria-label={t('板块排序')}>
          {sorts.map(item => <button key={item.id} type="button" aria-pressed={item.id === sort} onClick={() => { if (item.id !== sort) update({ sort: item.id, page: 1, selection: keepSelection }); }}>{t(item.label)}</button>)}
        </div>
      </div>
      <ResourceError error={error} loading={loading} onRetry={retry} label="重试板块" hasData={Boolean(data?.rows.length)} />
      {data?.rows.length ? <div className="cn-board-tiles">{data.rows.map(row => (
        <button type="button" key={row.ticker} data-direction={changeDirection(row.change_percent)}
          aria-pressed={board?.ticker === row.ticker} style={{ '--heat': `${5 + 19 * Math.abs(row.change_percent) / heatMax}%` } as CSSProperties}
          onClick={() => {
            update({ selection: { board: row, page: row.ticker === selectedTicker ? memberPage : 1 } });
            if (matchMedia('(max-width: 1050px)').matches) focusRef.current?.scrollIntoView({ block: 'start' });
          }}>
          <b>{row.name}</b><strong className={tone(row.change_percent)}>{percent(row.change_percent)}</strong>
          <small>{amount(row.amount)}</small>
        </button>
      ))}</div> : !error && <p className="cn-placeholder" role="status">{t(data && availablePage === page ? (search ? '没有匹配结果' : '暂无板块') : search ? '正在检索' : '加载中')}</p>}
      <footer className="cn-board-footer"><span>{data?.source}{data && ` · ${shanghaiClock(data.updated_at)}`}</span>
        {data && <Pager data={data} label={t('板块分页')} onPage={next => update({ page: next, selection: keepSelection })} />}
      </footer>
    </section>
    <section className="surface cn-board-focus" id="cn-board-focus" ref={focusRef} aria-label={t('焦点板块')}>
      <header className="cn-section-header"><h2>{board?.name ?? t('焦点板块')}{boardStale && <small className="cn-focus-stale">{t('缓存')}</small>}</h2>{board && <strong className={tone(board.change_percent)}>{percent(board.change_percent)}</strong>}</header>
      <ResourceError error={focused.error} loading={focused.loading} onRetry={focused.retry} label="重试焦点板块" hasData={Boolean(board)} />
      {board && <>
        <div className="cn-focus-stats"><div><small>{t('成交额')}</small><b>{amount(board.amount)}</b></div>
          <div><small>{t('领涨股')}</small><b>{board.leader_name || '—'} {board.leader_change != null && <span className={tone(board.leader_change)}>{percent(board.leader_change)}</span>}</b></div></div>
        <BreadthMeter up={board.advancers} flat={board.flat} down={board.decliners} />
        <div className="cn-members-head"><h3>{t('成分股')}</h3><small>{members.data?.stale && `${t('缓存')} · `}{members.data ? count(members.data.total) : '—'}</small>
          <div className="cn-segments quiet cn-members-sort" role="group" aria-label={t('成分股排序')}>
            {sorts.map(item => <button key={item.id} type="button" aria-pressed={item.id === memberSort} onClick={() => {
              if (item.id !== memberSort) update({ memberSort: item.id, selection: { board, page: 1 } });
            }}>{t(item.label)}</button>)}
          </div>
        </div>
        <ResourceError error={members.error} loading={members.loading} onRetry={members.retry} label="重试成分股" hasData={Boolean(members.data?.rows.length)} />
        {members.data?.rows.length ? <StockRows group="members" rows={members.data.rows} offset={(members.data.page - 1) * members.data.page_size} onSelect={(row, anchor) => {
          update({ selection: { board, page: availableMemberPage } });
          onSelect(row, anchor, true);
        }} />
          : !members.error && <p className="cn-placeholder" role="status">{t(members.data && availableMemberPage === memberPage ? '暂无成分股' : '加载中')}</p>}
        {members.data && <Pager data={members.data} label={t('成分股分页')} onPage={next => update({ selection: { board, page: next } })} />}
      </>}
    </section>
  </div>;
}

export function ChinaMarkets({ data, error, onSelect, boardView, onBoardViewChange }: {
  data: HotspotResponse | null;
  error: string | null;
  onSelect: (row: ChinaBoardMember, anchor: HTMLButtonElement, fromBoard?: boolean) => void;
  boardView: ChinaBoardView;
  onBoardViewChange: (view: ChinaBoardView) => void;
}) {
  const indices = useChinaIndices();
  const trend = useChinaIndexTrend();
  const main = indices.data?.rows.find(row => row.ticker === 'SH000001');
  const other = indices.data?.rows.filter(row => row.ticker !== 'SH000001') ?? [];
  const asOf = main?.as_of ?? other[0]?.as_of;
  return <div className="cn-market" aria-busy={indices.loading || trend.loading}>
    <section className="surface cn-index-radar">
      <header className="cn-section-header"><h2>{t('指数雷达')}</h2><small>{asOf && <time dateTime={asOf}>{shanghaiClock(asOf)}</time>}{indices.data?.stale && ` · ${t('缓存')}`}</small></header>
      <ResourceError error={indices.error} loading={indices.loading} onRetry={indices.retry} label="重试指数" hasData={Boolean(indices.data?.rows.length)} />
      <ResourceError error={trend.error} loading={trend.loading} onRetry={trend.retry} label="重试指数走势" hasData={Boolean(trend.data?.data.length)} />
      {main || other.length ? <div className={`cn-index-grid${main ? ' has-feature' : ''}`}>
        {main && <IndexCard row={main} history={trend.data} onSelect={onSelect} />}
        <div className="cn-index-compact">{other.map(row => <IndexCard key={row.ticker} row={row} onSelect={onSelect} />)}</div>
      </div> : !indices.error && <p className="cn-placeholder" role="status">{t('加载中')}</p>}
      {data && <div className="cn-market-breadth"><span>{t('涨跌分布')} <small>{t(data.summary.mode === 'full_market' ? '全市场' : '样本')}{data.stale && ` · ${t('缓存')}`}</small></span>
        <BreadthMeter up={data.breadth.advancers} flat={data.breadth.flat} down={data.breadth.decliners} /></div>}
    </section>
    <BoardPulse onSelect={onSelect} view={boardView} onViewChange={onBoardViewChange} />
    <div className="cn-rank-grid">{ranks.map(item => <section key={item.id} className="surface">
      <header className="cn-section-header"><h2>{t(item.label)}</h2>{data && data.summary.mode !== 'full_market' && <small>{t('样本')}</small>}</header>
      {data?.[item.id].length ? <StockRows group={item.id} rows={data[item.id]} onSelect={onSelect} /> : <p className="cn-placeholder">{t(data ? '暂无行情' : error ?? '加载中')}</p>}
    </section>)}</div>
  </div>;
}
