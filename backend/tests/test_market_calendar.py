import asyncio
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.api.ws.stock_updates import due_quotes, generate_stock_updates, refresh_interval
from app.services.market_calendar import market_hours
from app.schemas.stock import StockUpdate


class MarketCalendarTests(unittest.IsolatedAsyncioTestCase):
    def test_published_closures_and_early_closes(self):
        for day in ("2026-02-23", "2026-10-01", "2026-10-07", "2026-10-10"):
            self.assertIsNone(market_hours("CN", datetime.fromisoformat(day).date()))
        self.assertEqual(market_hours("CN", datetime(2026, 10, 8).date())["regular"], 900)
        self.assertIsNone(market_hours("US", datetime(2026, 11, 26).date()))
        self.assertEqual(market_hours("US", datetime(2026, 11, 27).date()), {"regular": 780, "late": 1020})
        self.assertEqual(market_hours("US", datetime(2027, 12, 31).date())["regular"], 960)

    def test_refresh_policy_respects_holidays_and_early_closes(self):
        def clock_at(iso):
            class Clock:
                @staticmethod
                def now(zone):
                    return datetime.fromisoformat(iso).astimezone(zone)
            return Clock

        for stamp, ticker, expected in [
            ("2026-10-01T10:30:00+08:00", "600519", 30),
            ("2026-10-08T10:30:00+08:00", "600519", 2),
            ("2026-11-26T10:30:00-05:00", "AAPL", 30),
            ("2026-11-27T12:59:00-05:00", "AAPL", 2),
            ("2026-11-27T13:06:00-05:00", "AAPL", 30),
        ]:
            with self.subTest(stamp=stamp), patch("app.api.ws.stock_updates.datetime", clock_at(stamp)):
                self.assertEqual(refresh_interval([ticker]), expected)

    def test_mixed_market_subscriptions_keep_independent_refresh_cadences(self):
        moment = datetime(2026, 11, 4, 2, 30, tzinfo=timezone.utc)

        class Clock:
            @staticmethod
            def now(zone):
                return moment.astimezone(zone)

        tickers, last, calls = ["600519", "AAPL"], {}, {"600519": [], "AAPL": []}
        with patch("app.api.ws.stock_updates.datetime", Clock):
            for second in range(31):
                for ticker in due_quotes(tickers, last, second):
                    calls[ticker].append(second)
                    last[ticker] = second
            self.assertEqual(calls["600519"], list(range(0, 31, 2)))
            self.assertEqual(calls["AAPL"], [0, 30])
            self.assertEqual(due_quotes([*tickers, "NVDA"], last, 31), ["NVDA"])
            moment = datetime(2026, 11, 4, 15, 30, tzinfo=timezone.utc)
            self.assertEqual(due_quotes(tickers, last, 32), ["AAPL"])

    async def test_stream_loop_does_not_refresh_closed_markets_at_the_open_markets_rate(self):
        elapsed, calls = 0.0, []
        manager = SimpleNamespace(subscriptions={"600519": [], "AAPL": []}, broadcast_to_subscribers=AsyncMock())

        class Clock:
            @staticmethod
            def now(zone):
                return datetime(2026, 11, 4, 2, 30, tzinfo=timezone.utc).astimezone(zone)

        async def sleep(delay):
            nonlocal elapsed
            elapsed += delay
            if elapsed == 1:
                manager.subscriptions["NVDA"] = []
            if elapsed > 30:
                raise asyncio.CancelledError()

        async def get_quotes(tickers):
            calls.append((elapsed, list(tickers)))
            return {ticker: StockUpdate(ticker=ticker, price=100, volume=1000, change_percent=1) for ticker in tickers}

        with patch("app.api.ws.stock_updates.manager", manager), \
             patch("app.api.ws.stock_updates.time", SimpleNamespace(monotonic=lambda: elapsed)), \
             patch("app.api.ws.stock_updates.datetime", Clock), \
             patch("app.api.ws.stock_updates.asyncio", SimpleNamespace(sleep=sleep, gather=asyncio.gather)), \
             patch("app.api.ws.stock_updates.stock_service.get_quote_batch", new=AsyncMock(side_effect=get_quotes)):
            with self.assertRaises(asyncio.CancelledError):
                await generate_stock_updates()
        self.assertEqual([stamp for stamp, batch in calls if "600519" in batch], list(range(0, 31, 2)))
        self.assertEqual([stamp for stamp, batch in calls if "AAPL" in batch], [0, 30])
        self.assertEqual([stamp for stamp, batch in calls if "NVDA" in batch], [1])
