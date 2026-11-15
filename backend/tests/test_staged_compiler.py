from pathlib import Path
import unittest
from app.services.staged_compiler import compile_staged_goal
from app.schemas.staged_strategy import StagedPlan

GOAL = (Path(__file__).parent / 'fixtures' / 'strategy_goal_920117.txt').read_text(encoding='utf-8')

class StagedCompilerTests(unittest.TestCase):
    def test_crypto_assumptions_use_coin_sizing_and_concise_news_settings(self):
        p=compile_staged_goal(GOAL.replace('920117','BTCUSDT'), 'CRYPTO')
        text=' '.join(p.assumptions)
        self.assertIn('小数币量',text)
        self.assertNotIn('A股首仓',text)
        self.assertNotIn('不编造',text)

    def test_supplied_goal_maps_all_explicit_numbers_and_discloses_unspecified_definitions(self):
        p = compile_staged_goal(GOAL)
        for key, value in {'maFast':5, 'maEntry':20, 'maLong':60, 'rsiPeriod':14, 'initialMinPct':6, 'initialMaxPct':8, 'initialPct':7, 'entryVolumeRatio':1, 'breakoutLower':24, 'breakoutUpper':25.3, 'confirmBars':3, 'addTargetPct':15, 'pullbackRsi':45, 'stopLossPct':8, 'lowLookback':20, 'trimRsi':70, 'trimFraction':.5, 'clearVolumeRatio':1.2, 'maxPositionPct':25, 'maxOrderPct':10, 'maxChasePct':10}.items():
            self.assertEqual(getattr(p,key),value,key)
        self.assertTrue(p.emergencyExitAll)
        self.assertTrue(p.reviewTurnover)
        self.assertGreaterEqual(len(p.assumptions),8)
        self.assertEqual(StagedPlan.model_validate(p.model_dump()),p)

    def test_other_values_are_parsed_instead_of_replaying_a_stock_specific_preset(self):
        goal=GOAL.replace('920117','600001').replace('MA5/20/60','MA10/30/90').replace('MA20','MA30').replace('MA60','MA90').replace('RSI14','RSI21').replace('6%-8%','4%-6%').replace('24.0-25.3','18.5-19.2').replace('加仓至15%','加仓至12%').replace('账户25%','账户20%').replace('单次不超过10%','单次不超过8%').replace('买入价8%','买入价5%').replace('量比>1、','量比>1.1、').replace('量比>1.2','量比>1.4')
        p=compile_staged_goal(goal)
        for key,value in {'maFast':10,'maEntry':30,'maLong':90,'rsiPeriod':21,'initialPct':5,'breakoutLower':18.5,'breakoutUpper':19.2,'addTargetPct':12,'maxPositionPct':20,'maxOrderPct':8,'stopLossPct':5,'entryVolumeRatio':1.1,'clearVolumeRatio':1.4}.items():
            self.assertEqual(getattr(p,key),value,key)

    def test_incomplete_generic_goals_do_not_invent_explicit_missing_price_bands(self):
        self.assertIsNone(compile_staged_goal('用MA20和RSI做分批加仓策略，考虑量比'))

if __name__ == '__main__':
    unittest.main()
