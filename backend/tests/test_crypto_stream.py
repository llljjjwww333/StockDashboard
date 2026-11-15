import json
import time
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.schemas.stock import StockUpdate
from app.services.crypto_stream import CryptoStream
from app.services.stock_data_service import StockDataService


class CryptoStreamTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.manager = SimpleNamespace(subscriptions={'BTCUSDT': [1, 2], 'ETHUSDT': [1]},
            details={1: ('BTCUSDT', '1m'), 2: ('BTCUSDT', '1d')},
            broadcast_to_subscribers=AsyncMock(), broadcast_detail=AsyncMock())
        self.service = SimpleNamespace(quote_cache={})
        self.feed = CryptoStream(self.manager, self.service)

    def test_shared_streams_only_request_depth_for_open_detail(self):
        streams = self.feed.streams()
        self.assertEqual(len(streams), 6)
        self.assertIn('btcusdt@depth20@100ms', streams)
        self.assertNotIn('ethusdt@depth20@100ms', streams)
        self.assertIn('btcusdt@kline_1d', streams)
        self.manager.details[2] = ('BTCUSDT', '1wk')
        self.assertIn('btcusdt@kline_1w', self.feed.streams())

    async def test_trade_updates_price_without_turning_rolling_volume_into_a_candle(self):
        self.service.quote_cache['BTCUSDT'] = (time.time(), StockUpdate(ticker='BTCUSDT', price=100,
            volume=98765.4321, change_percent=0, open_price=100))
        await self.feed.handle('btcusdt@aggTrade', {'T': 1000, 'p': '101.25'})
        quote = json.loads(self.manager.broadcast_to_subscribers.call_args.args[1])['data']
        self.assertEqual(quote['volume'], 98765.4321)
        self.assertEqual(quote['price'], 101.25)
        self.assertEqual(quote['change_percent'], 1.25)
        await self.feed.handle('btcusdt@aggTrade', {'T': 999, 'p': '95'})
        self.assertEqual(self.service.quote_cache['BTCUSDT'][1].price, 101.25)

    async def test_depth_is_a_complete_ten_level_snapshot_and_candle_keeps_utc_volume(self):
        await self.feed.handle('btcusdt@depth20@100ms', {'lastUpdateId': 12,
            'bids': [['100', '0.00012']] * 20, 'asks': [['101', '0.004']] * 20})
        message = self.manager.broadcast_detail.call_args.args[1]
        self.assertEqual(len(message['data']['book']['bids']), 10)
        self.assertEqual(message['data']['book']['bids'][0]['volume'], .00012)
        await self.feed.handle('btcusdt@kline_1d', {'E': 60000, 'k': {
            'i': '1d', 't': 0, 'o': '100', 'h': '102', 'l': '99', 'c': '101', 'v': '0.1234', 'x': False}})
        candle = self.manager.broadcast_detail.call_args.args[1]['data']
        self.assertEqual(candle['point']['timestamp'], '1970-01-01T00:00:00+00:00')
        self.assertEqual(candle['point']['volume'], .1234)

    async def test_disconnected_or_silent_feed_releases_rest_fallback(self):
        self.feed.connected = True
        self.feed.seen['BTCUSDT'] = time.monotonic()
        self.assertTrue(self.feed.healthy('BTCUSDT'))
        self.feed.seen['BTCUSDT'] -= 5
        self.assertFalse(self.feed.healthy('BTCUSDT'))
        self.feed.seen['BTCUSDT'] = time.monotonic()
        self.feed.connected = False
        self.assertFalse(self.feed.healthy('BTCUSDT'))

    async def test_delayed_rest_snapshot_cannot_rewind_newer_stream_quote(self):
        current = StockUpdate(ticker='BTCUSDT', price=101, volume=12, change_percent=1,
            as_of='2026-11-15T10:00:05+00:00')
        older = current.model_copy(update={'price': 100, 'as_of': '2026-11-15T10:00:01+00:00'})
        self.service.quote_cache['BTCUSDT'] = (time.time(), current)
        with patch('app.services.stock_data_service.crypto_market.quotes', new=AsyncMock(return_value={'BTCUSDT': older})):
            result = await StockDataService.get_quote_batch(self.service, ['BTCUSDT'])
        self.assertIs(result['BTCUSDT'], current)
        self.assertIs(self.service.quote_cache['BTCUSDT'][1], current)
