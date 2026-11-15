import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStrategyLibrary, strategyTradeCsv, writeStrategyLibrary,commitStrategyLibrary,saveStrategyReport,useStrategyWorkspace } from '../src/terminal/strategyWorkspace.ts';
import { strategyDefaults } from '../src/terminal/backtest.ts';

const snapshot = () => ({ version: 2, id: 'example', name: '测试报告', createdAt: '2025-02-01T00:00:00Z',
  instrument: { ticker: 'AAPL', name: 'Apple', market: 'US' }, period: '1y', source: 'Controlled', adjustment: 'qfq', stale: false,
  config: { ...strategyDefaults, fast: 2, slow: 3 },
  bars: Array.from({ length: 10 }, (_, i) => ({ timestamp: new Date(Date.UTC(2025, 0, i + 1)).toISOString(), open: 10 + i, close: 10 + i, high: 11 + i, low: 9 + i, volume: 100 })) });

test('saved reports are recomputed; supplied performance and unknown secret fields are discarded', () => {
  const input = snapshot(); input.result = { totalReturn: 999 }; input.config.apiKey = 'do not retain';
  const parsed = parseStrategyLibrary(JSON.stringify([input]));
  assert.equal(parsed.damaged, false);
  assert.equal(parsed.reports.length, 1);
  assert.notEqual(parsed.reports[0].result.totalReturn, 999);
  assert.equal(JSON.stringify(parsed.reports).includes('do not retain'), false);
});

test('malformed records never hide remaining valid snapshots', () => {
  const good = snapshot();
  const invalid = { ...snapshot(), id: 'bad', bars: [{ timestamp: null }] };
  const parsed = parseStrategyLibrary(JSON.stringify([invalid, good]));
  assert.equal(parsed.damaged, true);
  assert.equal(parsed.reports.length, 1);
  assert.equal(parseStrategyLibrary('broken').damaged, true);
  assert.equal(parseStrategyLibrary(JSON.stringify([{ ...good, instrument: { ...good.instrument, market: 'CN' } }])).reports.length, 0);
});

test('storage errors propagate for the UI to announce; only input snapshots are stored', () => {
  const reports = parseStrategyLibrary(JSON.stringify([snapshot()])).reports;
  let written;
  writeStrategyLibrary({ getItem: () => null, setItem: (_key, text) => { written = text; } }, reports);
  assert.equal(JSON.parse(written)[0].result, undefined);
  assert.throws(() => writeStrategyLibrary({ getItem: () => null, setItem: () => { throw new Error('Quota'); } }, reports));
  let attemptedWrite = false;
  assert.throws(() => writeStrategyLibrary({ getItem: () => { throw new Error('Blocked read'); }, setItem: () => { attemptedWrite = true; } }, reports));
  assert.equal(attemptedWrite, false);
});

test('CSV includes exact fill timing and protects textual cells from spreadsheet formulas', () => {
  const s = snapshot(); s.source = '=formula,"x"';
  const report = parseStrategyLibrary(JSON.stringify([s])).reports[0];
  const csv = strategyTradeCsv(report);
  assert(csv.startsWith('\uFEFFticker,signal_date,fill_date'));
  assert(csv.includes('"\'=formula,""x"""'));
  assert(csv.includes('2025-01-04T00:00:00.000Z,2025-01-05T00:00:00.000Z,buy'));
});
test('full result library rejects additional records instead of evicting saved research',()=>{
 let written=false;const reports=Array.from({length:13},(_,i)=>({snapshot:{...snapshot(),id:String(i)}}));
 assert.throws(()=>writeStrategyLibrary({getItem:()=>null,setItem:()=>{written=true;}},reports),/已满/);assert.equal(written,false);
});
test('failed save leaves visible records and current report unchanged',()=>{
 const report=parseStrategyLibrary(JSON.stringify([snapshot()])).reports[0],before=useStrategyWorkspace.getState(),storage=globalThis.localStorage;
 globalThis.localStorage={getItem:()=>null,setItem:()=>{throw new Error('quota');}};
 try{
  useStrategyWorkspace.setState({library:[report],report});assert.equal(commitStrategyLibrary([]),false);assert.deepEqual(useStrategyWorkspace.getState().library,[report]);
  assert.equal(saveStrategyReport(report,'unsaved rename'),false);assert.equal(useStrategyWorkspace.getState().report,report);
 }finally{globalThis.localStorage=storage;useStrategyWorkspace.setState(before);}
});
