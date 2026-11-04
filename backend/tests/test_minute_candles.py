import unittest
from unittest.mock import patch
from app.schemas.stock import StockDataPoint
from app.services.stock_data_service import StockDataService


def bar():
    return StockDataPoint(timestamp="2026-11-02T09:35:00+08:00", open=10.01, high=10.09, low=9.98, close=10.05, volume=1234)


class MinuteCandleTests(unittest.IsolatedAsyncioTestCase):
    async def test_snapshot_and_genuine_candles_have_independent_cache_entries(self):
        service = StockDataService()
        with patch.object(service, "_fetch_minute_history", return_value=([bar()], "snapshot source", 10, "snapshot")) as snapshot, patch.object(service, "_fetch_minute_candles", return_value=([bar()], "OHLC source")) as candle:
            line = await service.get_historical_data("600519", "1d", "1m")
            result = await service.get_historical_data("600519", "1d", "1m", candles=True)
            again = await service.get_historical_data("600519", "1d", "1m", candles=True)
        self.assertEqual(line.price_type, "snapshot")
        self.assertEqual(result.price_type, "ohlc")
        self.assertEqual(result.source, "OHLC source")
        self.assertEqual(again, result)
        self.assertEqual(snapshot.call_count, 1)
        self.assertEqual(candle.call_count, 1)
        self.assertEqual(len(service.history_cache), 2)

    async def test_all_minute_intervals_remain_requested_candle_intervals(self):
        service = StockDataService()
        for interval in ["1m", "5m", "15m", "30m", "1h"]:
            with self.subTest(interval=interval), patch.object(service, "_fetch_minute_candles", return_value=([bar()], "OHLC source")) as source:
                result = await service.get_historical_data("600519", "1d", interval, candles=True)
                self.assertEqual(result.interval, interval)
                self.assertEqual(result.price_type, "ohlc")
                source.assert_called_once_with("600519", "1d", interval, "CN")

    def test_china_candles_preserve_actual_ohlc_precision_and_share_volume(self):
        service = StockDataService()
        payload = {"data": {"klines": ["2026-11-02 09:35,1.234,1.235,1.238,1.231,123"]}}
        with patch.object(service, "_http_get_json", return_value=payload) as source:
            points, name = service._fetch_cn_minute_candles("510300", "1d", "5m")
        self.assertEqual(name, "Eastmoney")
        self.assertEqual((points[0].open, points[0].close, points[0].high, points[0].low), (1.234, 1.235, 1.238, 1.231))
        self.assertEqual(points[0].volume, 12300)
        self.assertIn("klt=5", source.call_args.args[0])
        self.assertIn("fqt=0", source.call_args.args[0])

    def test_us_candles_request_real_ohlc_and_filter_extended_hours(self):
        service = StockDataService()
        regular = bar().model_copy(update={"timestamp": "2026-10-30T09:45:00-04:00"})
        extended = regular.model_copy(update={"timestamp": "2026-10-30T08:00:00-04:00"})
        closing_snapshot = regular.model_copy(update={"timestamp": "2026-10-30T16:00:00-04:00", "volume": 0})
        with patch.object(service, "_fetch_us_chart_history", return_value=({}, [extended, regular, closing_snapshot])) as source:
            points, name = service._fetch_minute_candles("AAPL", "5d", "15m", "US")
        source.assert_called_once_with("AAPL", "5d", "15m")
        self.assertEqual(points, [regular])
        self.assertEqual(name, "Yahoo Finance")
