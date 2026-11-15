import copy
from pathlib import Path
from datetime import datetime, timezone
import unittest
from unittest.mock import AsyncMock, patch
from pydantic import ValidationError
from app.schemas.stock import StockUpdate, StockHistoryResponse
from app.services.trading_review import PortfolioReviewRequest, review_portfolio, PortfolioDesignRequest, design_portfolio
from app.services.analysis_service import ProviderError
from tests.test_strategy_generation import points, proposal as rule_proposal


def request(**changes):
    data = dict(settings={'base_url': 'https://fixture.example/v1', 'model': 'fixture', 'api_key': 'test-secret'}, market='US', goal='动态组合，不强制买入', universe=['AAPL'], holdings=[], cash=100000, max_single_pct=30, max_gross_pct=80, max_positions=1, fee_bps=5, slippage_bps=5)
    data.update(changes)
    return PortfolioReviewRequest(**data)


def decision():
    return {'regime': '震荡', 'method': '等待确认', 'summary': '当前保持现金，等待机会', 'reconsider_when': '趋势确认后再评估', 'targets': [], 'evidence_ids': ['Q:AAPL']}


class PortfolioReviewTests(unittest.IsolatedAsyncioTestCase):
    def service(self):
        class Service: pass
        s = Service()
        async def quote(ticker):
            return StockUpdate(ticker=ticker, name=ticker, price=100, volume=1000, change_percent=1, source='Fixture', as_of=datetime.now(timezone.utc).isoformat())
        s.get_real_time_data = AsyncMock(side_effect=quote)
        s.get_historical_data = AsyncMock(return_value=StockHistoryResponse(ticker='AAPL', data=points(), interval='1d', price_type='ohlc', source='Fixture'))
        s.get_finance_news = AsyncMock(side_effect=RuntimeError('No news'))
        s.get_market_hotspots = AsyncMock(return_value={'summary': {'mode': 'fixture'}})
        return s

    async def test_wait_is_valid_and_each_review_reloads_market_context(self):
        s = self.service()
        with patch('app.services.trading_review.request_model', return_value=decision()) as model:
            first = await review_portfolio(request(), s)
            await review_portfolio(request(), s)
        self.assertEqual(first['decision']['targets'], [])
        self.assertEqual(s.get_real_time_data.await_count, 2)
        self.assertEqual(s.get_historical_data.await_count, 2)
        context = model.call_args.args[2]['context']
        self.assertEqual(len(context['instruments']), 1)
        self.assertIn('indicators', context['instruments'][0]['history'])
        self.assertNotIn('test-secret', str(context))
        self.assertNotIn('test-secret', str(first))

    async def test_accepts_explicit_sell_for_the_requested_stock(self):
        d = decision(); d['targets'] = [{'ticker': 'AAPL', 'weight_pct': 0, 'reason': '退出'}]
        with patch('app.services.trading_review.request_model', return_value=d):
            result = await review_portfolio(request(holdings=[{'ticker': 'AAPL', 'shares': 100, 'cost': 10000, 'sellable': 100}]), self.service())
        self.assertEqual(result['decision']['targets'][0]['weight_pct'], 0)

    async def test_rejects_invalid_targets_missing_positions_and_invented_sources(self):
        bad = []
        d = decision(); d['targets'] = [{'ticker': 'AAPL', 'weight_pct': 50, 'reason': 'too much'}]; bad.append(d)
        d = decision(); d['evidence_ids'] = ['invented']; bad.append(d)
        d = decision(); d['targets'] = [{'ticker': 'BAD', 'weight_pct': 10, 'reason': 'unknown'}]; bad.append(d)
        d = decision(); d['targets'] = [{'ticker': 'AAPL', 'weight_pct': 10, 'reason': 'a'}] * 2; bad.append(d)
        for d in bad:
            with patch('app.services.trading_review.request_model', return_value=d):
                with self.assertRaises(ProviderError): await review_portfolio(request(), self.service())
        with patch('app.services.trading_review.request_model', return_value=decision()):
            with self.assertRaises(ProviderError): await review_portfolio(request(holdings=[{'ticker': 'AAPL', 'shares': 100, 'cost': 10000, 'sellable': 100}]), self.service())

    async def test_stale_quotes_do_not_invoke_model(self):
        s = self.service(); s.get_real_time_data.side_effect = None
        s.get_real_time_data.return_value = StockUpdate(ticker='AAPL', price=100, volume=1000, change_percent=0, stale=True, as_of='2020-01-01T00:00:00Z')
        with patch('app.services.trading_review.request_model') as model:
            with self.assertRaises(ProviderError): await review_portfolio(request(), s)
            model.assert_not_called()

    def test_currency_and_duplicate_universe_are_validated(self):
        with self.assertRaises(ValidationError): request(universe=['AAPL', 'AAPL'])
        with self.assertRaises(ValidationError): request(universe=['600519'])

    async def test_ai_design_returns_dynamic_mandate_without_buying(self):
        proposal = {'name': '动态策略', 'goal': '根据行情持续判断买卖和现金配置', 'max_single_pct': 25, 'review_minutes': 5, 'news': True, 'summary': '随行情变化调整方法', 'execution': {'rules': rule_proposal()['rules'], 'stop_loss_pct': 3, 'take_profit_pct': 12}}
        payload = PortfolioDesignRequest(ticker='AAPL', settings=request().settings, goal='控制风险')
        with patch('app.services.trading_review.request_model', return_value=proposal):
            service = self.service()
            result = await design_portfolio(payload, service)
            service.get_market_hotspots.assert_not_called()
        self.assertEqual(result['proposal']['execution'], proposal['execution'])
        self.assertEqual(result['proposal']['max_single_pct'], 25)
        self.assertIn('SMA(20)', result['proposal']['goal'])
        self.assertIn('25%', result['proposal']['goal'])
        self.assertNotIn('根据行情持续判断', result['proposal']['goal'])
        self.assertNotIn('test-secret', str(result))

    async def test_generated_description_uses_all_actual_rules_instead_of_unrelated_prose(self):
        rules = rule_proposal()['rules']
        rules['entry']['conditions'] = [
            {'left': {'indicator': 'close'}, 'operator': 'gt', 'right': {'indicator': 'sma', 'period': 23}},
            {'left': {'indicator': 'volume_ratio', 'period': 7}, 'operator': 'gte', 'right': {'value': 1.6}},
            {'left': {'indicator': 'macd'}, 'operator': 'gt', 'right': {'indicator': 'macd_signal'}},
        ]
        rules['exit']['conditions'] = [{'left': {'indicator': 'rsi', 'period': 14}, 'operator': 'lt', 'right': {'value': 45}}]
        proposal = {'name': '量价策略', 'goal': '与参数不一致的旧目标，突破25.3后分档加仓', 'max_single_pct': 25, 'review_minutes': 15, 'news': False, 'summary': '以结构化规则执行', 'execution': {'rules': rules, 'stop_loss_pct': 8, 'take_profit_pct': 20}}
        payload = PortfolioDesignRequest(ticker='AAPL', settings=request().settings, goal='均线、量比和MACD确认，RSI退出')
        with patch('app.services.trading_review.request_model', return_value=proposal):
            result = await design_portfolio(payload, self.service())
        goal = result['proposal']['goal']
        for text in ['SMA(23)', '量比(7) 大于等于 1.6', 'MACD DIF(12/26/9)', 'MACD DEA(12/26/9)', 'RSI(14) 小于 45', '25%', '8%', '20%']:
            self.assertIn(text, goal)
        self.assertNotIn('分档加仓', goal)
        self.assertEqual(result['proposal']['execution'], proposal['execution'])

    async def test_single_stock_review_receives_only_its_instrument_and_other_assets_are_valuation_only(self):
        with patch('app.services.trading_review.request_model', return_value=decision()) as model:
            result = await review_portfolio(request(universe=['AAPL'], cash=50000, other_equity=30000), self.service())
        context = model.call_args.args[2]['context']
        self.assertEqual([r['ticker'] for r in context['instruments']], ['AAPL'])
        self.assertEqual(context['portfolio']['equity'], 80000)
        self.assertEqual(result['decision']['targets'], [])
        self.assertIn('仅负责单只股票', model.call_args.args[1])

    async def test_ai_design_rejects_text_only_strategy_without_execution_rules(self):
        payload = PortfolioDesignRequest(ticker='AAPL', settings=request().settings, goal='follow trend')
        text_only = {'name': 'Text only', 'goal': 'buy on a good day', 'max_single_pct': 25, 'review_minutes': 5, 'news': True, 'summary': 'No executable rules'}
        with patch('app.services.trading_review.request_model', return_value=text_only):
            with self.assertRaises(ProviderError):
                await design_portfolio(payload, self.service())

    async def test_ai_design_rejects_volume_ratio_compared_to_price_instead_of_using_it(self):
        rules = rule_proposal()['rules']
        rules['entry']['conditions'] = [{'left': {'indicator': 'volume_ratio', 'period': 20}, 'operator': 'gt', 'right': {'indicator': 'sma', 'period': 20}}]
        proposal = {'name': 'Invalid units', 'goal': 'volume confirmation', 'max_single_pct': 25, 'review_minutes': 5, 'news': True, 'summary': 'Invalid comparison', 'execution': {'rules': rules, 'stop_loss_pct': 8, 'take_profit_pct': 0}}
        with patch('app.services.trading_review.request_model', return_value=proposal):
            with self.assertRaisesRegex(ProviderError, '不兼容的指标比较'):
                await design_portfolio(PortfolioDesignRequest(ticker='AAPL', settings=request().settings, goal='volume confirmation'), self.service())

    async def test_exact_multistage_goal_compiles_complete_plan_without_calling_model(self):
        goal = (Path(__file__).parent / 'fixtures' / 'strategy_goal_920117.txt').read_text(encoding='utf-8')
        payload = PortfolioDesignRequest(ticker='920117', market='CN', settings=request().settings, goal=goal)
        service = self.service()
        with patch('app.services.trading_review.request_model') as model:
            result = await design_portfolio(payload, service)
            self.assertEqual(result['proposal']['goal'], goal)
            plan = result['proposal']['execution']['plan']
            for key,value in {'maEntry':20,'maLong':60,'rsiPeriod':14,'initialPct':7,'maxPositionPct':25,'maxOrderPct':10,'stopLossPct':8,'breakoutLower':24,'breakoutUpper':25.3,'confirmBars':3,'pullbackRsi':45}.items():
                self.assertEqual(plan[key],value)
            self.assertEqual(result['source'],'goal_compiler')
            model.assert_not_called()
        service.get_real_time_data.assert_not_awaited()
        self.assertEqual(payload.goal, goal)

    async def test_news_risk_review_cannot_increase_the_staged_price_target(self):
        d = decision();d['targets'] = [{'ticker':'AAPL','weight_pct':15,'reason':'increase'}]
        with patch('app.services.trading_review.request_model', return_value=d) as model:
            with self.assertRaisesRegex(ProviderError,'不得提高'):
                await review_portfolio(request(rule_target_pct=7), self.service())
            self.assertEqual(model.call_args.args[2]['context']['proposed_rule_target_pct'],7)
        d['targets'][0]['weight_pct']=7
        with patch('app.services.trading_review.request_model', return_value=d):
            result=await review_portfolio(request(rule_target_pct=7),self.service())
            self.assertEqual(result['decision']['targets'][0]['weight_pct'],7)

    async def test_explicit_goal_ticker_cannot_be_applied_to_a_different_selected_stock(self):
        goal=(Path(__file__).parent/'fixtures'/'strategy_goal_920117.txt').read_text(encoding='utf-8')
        service=self.service()
        with patch('app.services.trading_review.request_model') as model:
            with self.assertRaisesRegex(ValueError,'标的不一致|不一致'):
                await design_portfolio(PortfolioDesignRequest(ticker='AAPL',market='US',settings=request().settings,goal=goal),service)
            model.assert_not_called()
        service.get_real_time_data.assert_not_awaited()
