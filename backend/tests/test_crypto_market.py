import asyncio
import unittest
from unittest.mock import patch
from datetime import datetime, timezone
from app.services.crypto_market import CryptoMarket, is_crypto
from app.services.daily_history import completed_daily_bars

ROW = dict(symbol='BTCUSDT', lastPrice='75000.01', volume='0.12345678', quoteVolume='9259.26', priceChange='100', priceChangePercent='0.1', openPrice='74900.01', highPrice='76000', lowPrice='74000', closeTime=1794124800000)

class CryptoMarketTests(unittest.IsolatedAsyncioTestCase):
    async def test_quotes_use_one_selected_batch_and_retain_fractional_units(self):
        calls=[]
        def fetch(path, params):
            calls.append((path,params)); return ROW
        market=CryptoMarket(fetch)
        a,b=await asyncio.gather(market.quotes(['BTCUSDT']),market.quotes(['BTCUSDT']))
        self.assertEqual(len(calls),1); self.assertEqual(calls[0][1],{'symbol':'BTCUSDT'})
        self.assertEqual(a['BTCUSDT'].volume,.12345678); self.assertEqual(a['BTCUSDT'].price,75000.01)
        self.assertEqual(a,b); self.assertIsNone(a['BTCUSDT'].pe_ratio)

    async def test_depth_retains_real_coin_quantities(self):
        market=CryptoMarket(lambda path,params:{'bids':[['75000','0.00001234']],'asks':[['75001','0.54321']]})
        depth=await market.depth('BTCUSDT')
        self.assertEqual(depth.bids[0].volume,.00001234); self.assertEqual(depth.asks[0].price,75001)

    async def test_search_uses_live_trading_usdt_pairs_and_chinese_aliases(self):
        def fetch(path,params):
            return {'symbols':[dict(symbol='BTCUSDT',baseAsset='BTC',quoteAsset='USDT',status='TRADING'),dict(symbol='BTCUSDC',baseAsset='BTC',quoteAsset='USDC',status='TRADING'),dict(symbol='OLDUSDT',baseAsset='OLD',quoteAsset='USDT',status='BREAK')]}
        market=CryptoMarket(fetch)
        rows=await market.search('比特币'); self.assertEqual([r['ticker'] for r in rows],['BTCUSDT'])
        self.assertEqual(rows[0]['market'],'CRYPTO'); self.assertEqual(await market.search('AAPL'),[])

    async def test_minute_history_pages_past_thousand_without_loss_or_duplicate_bars(self):
        calls=[]
        def fetch(path,params):
            calls.append(params)
            return [[stamp,'75000','75001','74999','75000.5','.00001'] for stamp in range(params['startTime'],params['endTime']+1,60000)]
        market=CryptoMarket(fetch)
        with patch('app.services.crypto_market.time.time',return_value=1794297600):
            history=await market.history('BTCUSDT','5d','1m')
        self.assertEqual(len(calls),8); self.assertEqual(len(history.data),7201)  # includes the newly opened minute
        self.assertEqual(len({r.timestamp for r in history.data}),7201); self.assertEqual(history.data[0].volume,.00001)
        self.assertEqual(history.adjustment,'none'); self.assertEqual(history.source,'Binance Spot')

    async def test_daily_history_and_review_keep_weekends_but_exclude_open_utc_day(self):
        def fetch(path,params):
            return [[stamp,'1','2','.5','1.5','.1'] for stamp in range(params['startTime'],params['endTime']+1,86400000)]
        market=CryptoMarket(fetch)
        with patch('app.services.crypto_market.time.time',return_value=1794124800):
            history=await market.history('ETHUSDT','1y','1d')
        self.assertGreaterEqual(len(history.data),366)
        now=datetime(2026,11,8,2,tzinfo=timezone.utc)
        complete=completed_daily_bars(history,'CRYPTO',now)
        self.assertEqual(complete[-1].timestamp[:10],'2026-11-07')
        self.assertTrue(any(datetime.fromisoformat(p.timestamp).weekday()==5 for p in complete))

    async def test_source_failure_does_not_invent_market_data(self):
        def fail(path,params): raise OSError('offline')
        market=CryptoMarket(fail)
        with self.assertRaises(OSError): await market.quotes(['BTCUSDT'])
        with self.assertRaises(OSError): await market.history('BTCUSDT','1y','1d')
        self.assertTrue(is_crypto('BTCUSDT')); self.assertFalse(is_crypto('AAPL'))

if __name__=='__main__': unittest.main()
