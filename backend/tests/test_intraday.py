from datetime import datetime, timedelta
import asyncio
import time
import unittest
from unittest.mock import patch

from app.schemas.stock import StockDataPoint
from app.services.stock_data_service import StockDataService


def point(date, time="09:30", price=100):
    return StockDataPoint(timestamp=f"{date}T{time}:00+08:00", open=price, high=price, low=price, close=price, volume=100)


class IntradayTests(unittest.IsolatedAsyncioTestCase):
    def test_tencent_minutes_use_actual_sessions_and_incremental_share_volume(self):
        service = StockDataService()
        days = [{"date": f"202610{day}", "prec": "4.060", "data": [
            "0925 4.060 5 2030", "0930 4.061 10 4061", "0931 4.062 14 5685",
            "0931 4.062 14 5685", "1130 4.065 20 8127", "1300 4.066 20 8127",
            "1500 4.067 25 10160", "1530 4.070 28 11380",
        ]} for day in [30, 29, 28, 27, 26, 23]]
        payload = {"data": {"sh510300": {"data": days}}}
        points, reference = service._parse_tencent_intraday(payload, "sh510300", "CN", "5d")
        self.assertEqual(len(points), 25)
        self.assertEqual(len({p.timestamp[:10] for p in points}), 5)
        self.assertTrue(points[0].timestamp.startswith("2026-10-26"))
        self.assertEqual([p.volume for p in points[:5]], [1000, 400, 600, 0, 500])
        self.assertEqual(points[0].close, 4.061)
        self.assertEqual(points[0].average_price, 4.061)
        self.assertEqual(reference, 4.06)
        latest, _ = service._parse_tencent_intraday(payload, "sh510300", "CN", "1d")
        self.assertEqual(len(latest), 5)
        self.assertTrue(all(p.timestamp.startswith("2026-10-30") for p in latest))

    def test_us_minutes_do_not_use_china_volume_multiplier_or_local_timezone(self):
        payload = {"data": {"usAAPL.OQ": {"data": {"date": "20261030", "data": ["0930 348.32 100", "1600 344.63 150"]}, "qt": {"usAAPL.OQ": ["", "", "", "", "348.91"]}}}}
        points, reference = StockDataService()._parse_tencent_intraday(payload, "usAAPL.OQ", "US", "1d")
        self.assertEqual([p.volume for p in points], [100, 50])
        self.assertTrue(points[0].timestamp.endswith("-04:00"))
        self.assertEqual(reference, 348.91)

    def test_five_days_selects_dates_not_a_fixed_number_of_bars(self):
        data = [point(f"2026-10-{day}", time) for day in [20, 21, 22, 23, 26, 27, 28, 29, 30] for time in ["09:30", "10:00", "15:00"]]
        result = StockDataService()._trim_points_for_period(data, "5d")
        self.assertEqual(len(result), 15)
        self.assertEqual(result[0].timestamp[:10], "2026-10-26")
        self.assertEqual(result[-1].timestamp[:10], "2026-10-30")

    def test_day_selection_keeps_the_open_and_close_without_tail_truncation(self):
        data = [point("2026-10-30", f"{9 + (30 + i) // 60:02d}:{(30 + i) % 60:02d}") for i in range(391)]
        result = StockDataService()._trim_points_for_period(data, "1d")
        self.assertEqual(len(result), 391)
        self.assertIn("09:30", result[0].timestamp)
        self.assertIn("16:00", result[-1].timestamp)

    def test_month_is_a_calendar_month_not_thirty_trading_bars(self):
        data = [point((datetime(2026, 9, 1) + timedelta(days=i)).date().isoformat()) for i in range(60)]
        result = StockDataService()._trim_points_for_period(data, "1mo")
        self.assertEqual(result[0].timestamp[:10], "2026-10-01")
        self.assertEqual(result[-1].timestamp[:10], "2026-10-30")

    def test_sanitization_retains_etf_price_precision_and_vwap(self):
        result = StockDataService()._sanitize_history_points([point("2026-10-30", price=4.065)])
        self.assertEqual(result[0].close, 4.065)

    async def test_index_history_discards_share_average_without_changing_index_prices(self):
        service = StockDataService()
        bar = point("2026-11-04", price=3650.4).model_copy(update={"average_price": 14.84})
        with patch.object(service, "_fetch_minute_history", return_value=([bar], "Tencent Finance", 3608.1, "snapshot")):
            index = await service.get_historical_data("SH000001", "1d", "1m")
            equity = await service.get_historical_data("600519", "1d", "1m")
        self.assertEqual(index.reference_price, 3608.1)
        self.assertEqual(index.data[0].close, 3650.4)
        self.assertIsNone(index.data[0].average_price)
        self.assertEqual(equity.data[0].average_price, 14.84)

    async def test_minute_history_publishes_source_metadata_and_uses_short_cache(self):
        service = StockDataService()
        data = [point("2026-10-30", "09:30"), point("2026-10-30", "09:31")]
        with patch.object(service, "_fetch_minute_history", return_value=(data, "Tencent Finance", 99, "snapshot")) as fetch:
            result = await service.get_historical_data("600519", "5d", "1m")
            self.assertEqual(result.interval, "1m")
            self.assertEqual(result.reference_price, 99)
            self.assertEqual(result.price_type, "snapshot")
            self.assertEqual(result.adjustment, "none")
            await service.get_historical_data("600519", "5d", "1m")
            self.assertEqual(fetch.call_count, 1)
            key = "600519:5d:1m"
            saved_at, cached = service.history_cache[key]
            service.history_cache[key] = (saved_at - 11, cached)
            await service.get_historical_data("600519", "5d", "1m")
            await asyncio.gather(*list(service.history_refresh_tasks.values()))
            self.assertEqual(fetch.call_count, 2)

    def test_legacy_week_aliases_real_five_day_view_and_defaults_to_one_minute(self):
        service = StockDataService()
        self.assertEqual(service.normalize_period("1wk"), "5d")
        self.assertEqual(service.normalize_interval("5d", "1d"), "1m")

    def test_us_fallback_requests_one_minute_not_coarser_bars(self):
        service = StockDataService()
        valid = point("2026-10-30", "15:00").model_copy(update={"timestamp": "2026-10-30T15:00:00-04:00"})
        for period in ["1d", "5d"]:
            with self.subTest(period=period), patch.object(service, "_fetch_intraday_tencent", side_effect=OSError()), patch.object(service, "_fetch_us_chart_history", return_value=({"previousClose": 99}, [valid])) as fetch:
                service._fetch_minute_history("AAPL", period, "US")
            fetch.assert_called_once_with("AAPL", period, "1m")

    async def test_concurrent_history_readers_share_one_source_fetch(self):
        service = StockDataService()
        def fetch(*args):
            time.sleep(.02)
            return [point("2026-10-30", "09:30"), point("2026-10-30", "09:31")], "Tencent Finance", 99, "snapshot"
        with patch.object(service, "_fetch_minute_history", side_effect=fetch) as source:
            results = await asyncio.gather(*(service.get_historical_data("600519", "5d", "1m") for _ in range(5)))
        self.assertEqual(source.call_count, 1)
        self.assertTrue(all(result.interval == "1m" for result in results))


if __name__ == "__main__":
    unittest.main()
