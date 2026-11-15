import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch
from app.schemas.stock import StockHistoryResponse, StockDataPoint
from app.services.daily_history import completed_daily_bars
from app.services.trading_review import PortfolioDesignRequest, design_portfolio
from tests.test_portfolio_review import request
from tests.test_strategy_generation import proposal as rule_proposal


def history(fetched):
    start = datetime(2026, 9, 1, tzinfo=timezone.utc)
    points = [StockDataPoint(timestamp=(start + timedelta(days=i)).isoformat(), open=100+i, high=102+i, low=99+i, close=101+i, volume=10000) for i in range(90)]
    return StockHistoryResponse(ticker='600519', data=points, interval='1d', fetched_at=fetched)


class DailyHistoryTests(unittest.TestCase):
    def test_china_post_close_fetch_includes_today_but_pre_close_cache_does_not(self):
        now = datetime.fromisoformat('2026-11-09T15:00:10+08:00')
        for fetched, expected in [('2026-11-09T14:59:50+08:00', '2026-11-06'), ('2026-11-09T15:00:10+08:00', '2026-11-09'), (None, '2026-11-06')]:
            self.assertEqual(completed_daily_bars(history(fetched), 'CN', now)[-1].timestamp[:10], expected)

    def test_us_early_close_and_thanksgiving(self):
        before = datetime.fromisoformat('2026-11-27T12:59:59-05:00')
        after = datetime.fromisoformat('2026-11-27T13:00:01-05:00')
        self.assertEqual(completed_daily_bars(history(before.isoformat()), 'US', before)[-1].timestamp[:10], '2026-11-25')
        self.assertEqual(completed_daily_bars(history(after.isoformat()), 'US', after)[-1].timestamp[:10], '2026-11-27')

    def test_future_fetch_time_does_not_admit_current_bar(self):
        now = datetime.fromisoformat('2026-11-09T15:00:10+08:00')
        self.assertEqual(completed_daily_bars(history('2026-11-10T15:00:00+08:00'), 'CN', now)[-1].timestamp[:10], '2026-11-06')

    def test_holiday_and_non_session_rows_are_excluded(self):
        now = datetime.fromisoformat('2026-10-08T14:00:00+08:00')
        bars = completed_daily_bars(history(now.isoformat()), 'CN', now)
        self.assertEqual(bars[-1].timestamp[:10], '2026-09-30')
        self.assertFalse(any('2026-10-01' <= p.timestamp[:10] <= '2026-10-07' for p in bars))


class DesignSessionTests(unittest.IsolatedAsyncioTestCase):
    async def test_design_receives_the_post_close_day_without_future_rows(self):
        moment = datetime.fromisoformat('2026-11-09T15:01:00+08:00')
        class Clock(datetime):
            @classmethod
            def now(cls, tz=None):
                return moment.astimezone(tz or timezone.utc)
        class Service: pass
        service=Service()
        service.get_real_time_data=AsyncMock(side_effect=RuntimeError('No quote'))
        service.get_finance_news=AsyncMock(side_effect=RuntimeError('No news'))
        service.get_historical_data=AsyncMock(return_value=history(moment.isoformat()))
        proposal={'name':'规则','goal':'趋势','max_single_pct':25,'review_minutes':5,'news':False,'summary':'规则','execution':{'rules':rule_proposal()['rules'],'stop_loss_pct':3,'take_profit_pct':12}}
        payload=PortfolioDesignRequest(ticker='600519',market='CN',settings=request().settings,goal='趋势')
        with patch('app.services.trading_review.datetime',Clock),patch('app.services.trading_review.request_model',return_value=proposal) as model:
            await design_portfolio(payload,service)
        bars=model.call_args.args[2]['context']['bars']
        self.assertEqual(bars[-1]['timestamp'][:10],'2026-11-09')
        self.assertTrue(all(p['timestamp'][:10]<='2026-11-09' for p in bars))
