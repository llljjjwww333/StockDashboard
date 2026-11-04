import asyncio
import threading
import time
import unittest
from unittest.mock import patch

from app.schemas.stock import StockDataPoint, StockHistoryResponse
from app.services.stock_data_service import StockDataService


def bars(value=100):
    return [StockDataPoint(timestamp="2026-11-02T09:30:00+08:00", open=value, high=value, low=value, close=value, volume=100)]


class LoadingTests(unittest.IsolatedAsyncioTestCase):
    async def test_expired_cache_returns_before_refresh_and_shares_background_work(self):
        service = StockDataService()
        key = "600519:1d:1m"
        old = StockHistoryResponse(ticker="600519", data=bars(), fetched_at="old", source="fixture")
        service.history_cache[key] = (time.time() - 11, old)
        release = threading.Event()
        def fetch(*args):
            release.wait(2)
            return bars(101), "Tencent Finance", 99, "snapshot"
        try:
            with patch.object(service, "_fetch_minute_history", side_effect=fetch) as source:
                results = await asyncio.wait_for(asyncio.gather(*(service.get_historical_data("600519", "1d", "1m") for _ in range(5))), .5)
                self.assertTrue(all(r.stale and r.fetched_at == "old" and r.data[0].close == 100 for r in results))
                self.assertEqual(len(service.history_refresh_tasks), 1)
                release.set()
                await asyncio.gather(*list(service.history_refresh_tasks.values()))
                self.assertEqual(source.call_count, 1)
                fresh = await service.get_historical_data("600519", "1d", "1m")
                self.assertFalse(fresh.stale)
                self.assertEqual(fresh.data[0].close, 101)
        finally:
            release.set()

    async def test_failed_background_refresh_keeps_timestamp_and_throttles_retries(self):
        service = StockDataService()
        key = "600519:1d:1m"
        service.history_cache[key] = (time.time() - 20, StockHistoryResponse(ticker="600519", data=bars(), fetched_at="old"))
        with patch.object(service, "_fetch_minute_history", side_effect=OSError("offline")) as source:
            await service.get_historical_data("600519", "1d", "1m")
            await asyncio.gather(*list(service.history_refresh_tasks.values()))
            result = await service.get_historical_data("600519", "1d", "1m")
            self.assertEqual(source.call_count, 1)
            self.assertEqual(result.fetched_at, "old")
            self.assertTrue(result.stale)
            self.assertFalse(service.history_refresh_tasks)

    def test_slow_primary_does_not_hold_up_a_working_fallback(self):
        release = threading.Event()
        def primary():
            release.wait(2)
            return bars(), "primary"
        try:
            result = StockDataService()._hedged_history_fetch(primary, lambda: (bars(102), "fallback"), delay=.01)
            self.assertEqual(result[1], "fallback")
            self.assertFalse(release.is_set())
        finally:
            release.set()

    def test_beijing_daily_history_prefers_the_complete_source(self):
        service = StockDataService()
        with patch.object(service, "_fetch_cn_daily_eastmoney", return_value=(bars(), "Eastmoney")) as eastmoney, patch.object(service, "_fetch_cn_daily_history") as tencent:
            result = service._fetch_cn_daily_fast("920117", "1mo")
        self.assertEqual(result[1], "Eastmoney")
        eastmoney.assert_called_once_with("920117", "1mo")
        tencent.assert_not_called()

    def test_us_daily_backup_starts_while_symbol_resolution_is_blocked(self):
        service = StockDataService()
        release = threading.Event()
        def resolve(*args):
            release.wait(2)
            raise OSError("primary unavailable")
        try:
            with patch.object(service, "_fetch_batch_quotes", side_effect=resolve), patch.object(service, "_fetch_us_chart_history", return_value=({}, bars())) as backup:
                result = service._fetch_us_history("AAPL", "1mo", "1d")
                self.assertEqual(result[1], "Yahoo Finance")
                self.assertFalse(release.is_set())
                backup.assert_called_once_with("AAPL", "3mo", "1d")
        finally:
            release.set()

    def test_daily_backup_uses_adjusted_ohlc_and_share_units(self):
        service = StockDataService()
        payload = {"data": {"klines": ["2026-11-02,21.98,21.92,22.21,21.42,8422"]}}
        with patch.object(service, "_http_get_json", return_value=payload) as source:
            result, name = service._fetch_cn_daily_eastmoney("920117", "1mo")
        self.assertEqual(name, "Eastmoney")
        self.assertEqual(result[0].volume, 842200)
        self.assertEqual(result[0].close, 21.92)
        self.assertIn("fqt=1", source.call_args.args[0])
        self.assertIn("secid=0.920117", source.call_args.args[0])


if __name__ == "__main__":
    unittest.main()
