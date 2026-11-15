import copy
import json
from pathlib import Path
import unittest
from unittest.mock import AsyncMock, patch
from datetime import datetime, timedelta, timezone
from app.schemas.stock import StockHistoryResponse, StockDataPoint
from app.services.trading_review import PortfolioDesignRequest, design_portfolio
from app.services.analysis_service import ProviderError
from app.services.strategy_capabilities import strategy_capability_issues
import tests.test_portfolio_review as reviews

FIXTURE = json.loads((Path(__file__).parent/'fixtures/volatility_target_design.json').read_text(encoding='utf-8'))


class VolatilityDesignTests(unittest.IsolatedAsyncioTestCase):
    def service(self):
        service = reviews.PortfolioReviewTests().service()
        points = [StockDataPoint(timestamp=(datetime(2024,1,1,tzinfo=timezone.utc)+timedelta(days=i)).isoformat(),
            open=100+i, high=102+i, low=99+i, close=101+i, volume=1) for i in range(300)]
        service.get_historical_data = AsyncMock(return_value=StockHistoryResponse(ticker='BTCUSDT',data=points,interval='1d',source='Fixture'))
        return service

    async def test_ai_receives_the_full_table_and_schema_can_return_the_exact_formula(self):
        service = self.service()
        payload = PortfolioDesignRequest(ticker='BTCUSDT', market='CRYPTO', settings=reviews.request().settings, goal=FIXTURE['goal'])
        with patch('app.services.trading_review.request_model', return_value=copy.deepcopy(FIXTURE['proposal'])) as model:
            result = await design_portfolio(payload, service)
        self.assertEqual(model.call_count, 1)
        self.assertEqual(model.call_args.args[2]['goal'], FIXTURE['goal'])
        schema = model.call_args.args[2]['output_schema']
        self.assertIn('VolatilityAllocation', schema['$defs'])
        self.assertIn('factor', schema['$defs']['PeriodOperand']['properties'])
        self.assertIn('momentum', schema['$defs']['PeriodOperand']['properties']['indicator']['enum'])
        execution = result['proposal']['execution']
        self.assertEqual(execution['allocation']['targetVolPct'],10)
        self.assertEqual(execution['rules']['entry']['conditions'][0]['right']['factor'],1.01)
        self.assertEqual(execution['environment']['feeBps'],10)
        self.assertIn('MOM(90)',result['proposal']['goal'])
        self.assertNotIn('年化收益率',result['proposal']['goal'])
        self.assertEqual(strategy_capability_issues(FIXTURE['goal']),[])

    async def test_missing_dynamic_sizing_is_rejected_instead_of_becoming_fixed_allocation(self):
        proposal=copy.deepcopy(FIXTURE['proposal']);proposal['execution'].pop('allocation')
        payload=PortfolioDesignRequest(ticker='BTCUSDT',market='CRYPTO',settings=reviews.request().settings,goal=FIXTURE['goal'])
        with patch('app.services.trading_review.request_model',return_value=proposal):
            with self.assertRaisesRegex(ProviderError,'动态仓位'):
                await design_portfolio(payload,self.service())

    def test_long_parameter_tables_are_not_cut_at_two_thousand_characters(self):
        goal=FIXTURE['goal']+'\n参数说明。'*600
        self.assertGreater(len(goal),2000)
        self.assertEqual(PortfolioDesignRequest(ticker='BTCUSDT',goal=goal).goal,goal)

    async def test_wrong_default_period_factor_or_cost_cannot_be_silently_accepted(self):
        for mutate in [lambda p:p['execution']['rules']['entry']['conditions'][0]['right'].update(period=20),
            lambda p:p['execution']['rules']['exit']['conditions'][0]['right'].update(factor=1),
            lambda p:p['execution']['allocation'].update(targetVolPct=20),
            lambda p:p['execution']['environment'].update(feeBps=5)]:
            proposal=copy.deepcopy(FIXTURE['proposal']);mutate(proposal)
            payload=PortfolioDesignRequest(ticker='BTCUSDT',market='CRYPTO',settings=reviews.request().settings,goal=FIXTURE['goal'])
            with patch('app.services.trading_review.request_model',return_value=proposal):
                with self.assertRaisesRegex(ProviderError,'未完整转换'):
                    await design_portfolio(payload,self.service())
