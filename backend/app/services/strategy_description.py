"""Human-readable strategy text derived from the exact executable definition."""

ZH_NAMES = {
    'close': '收盘价', 'open': '开盘价', 'high': '最高价', 'low': '最低价',
    'volume': '成交量', 'obv': 'OBV', 'macd': 'MACD DIF(12/26/9)',
    'macd_signal': 'MACD DEA(12/26/9)', 'sma': 'SMA', 'ema': 'EMA',
    'rsi': 'RSI', 'momentum': 'MOM', 'roc': 'ROC(%)', 'atr_pct': 'ATR(%)', 'volume_ratio': '量比',
    'cci': 'CCI', 'williams': 'Williams %R', 'adx': 'ADX',
    'boll_upper': '布林上轨', 'boll_lower': '布林下轨',
}
ZH_OPERATORS = {'gt': '大于', 'gte': '大于等于', 'lt': '小于', 'lte': '小于等于', 'cross_above': '上穿', 'cross_below': '下穿'}
EN_OPERATORS = {'gt': '>', 'gte': '>=', 'lt': '<', 'lte': '<=', 'cross_above': 'crosses above', 'cross_below': 'crosses below'}


def execution_description(ticker, execution, position_pct, language='zh'):
    zh = language != 'en'

    def number(value):
        return str(value).removesuffix('.0')

    def operand(value):
        if hasattr(value, 'value'):
            return number(value.value)
        name = ZH_NAMES[value.indicator] if zh else value.indicator
        if hasattr(value, 'period'):
            name += f'({value.period}'
            if hasattr(value, 'multiplier'):
                name += f', {number(value.multiplier)}σ'
            name += ')'
        if getattr(value, 'factor', None) not in (None, 1):
            name += ' × ' + number(value.factor)
        return name

    def group(value):
        conditions = [f'{operand(c.left)} {(ZH_OPERATORS if zh else EN_OPERATORS)[c.operator]} {operand(c.right)}' for c in value.conditions]
        if zh:
            return ('全部满足：' if value.mode == 'all' else '任一满足：') + '；'.join(conditions)
        return ('all: ' if value.mode == 'all' else 'any: ') + '; '.join(conditions)

    stop = execution.stop_loss_pct
    profit = execution.take_profit_pct
    allocation = getattr(execution, 'allocation', None)
    if allocation:
        return (f'仅交易{ticker}，初始现金，现货只做多。\n买入（{group(execution.rules.entry)}）。'
                f'\n清仓（{group(execution.rules.exit)}）。\n目标波动率{number(allocation.targetVolPct)}%，'
                f'对数收益率{allocation.period}日标准差×√{allocation.annualization}；'
                f'w=min({number(position_pct)}%,max({number(allocation.minPositionPct)}%,{number(allocation.targetVolPct)}%/σ))，信号失效0%。'
                f'每日再平衡，阈值{number(allocation.rebalanceThresholdPct)}个百分点，1D UTC完整日K收盘判断，下一根开盘执行。')
    if zh:
        return (f'仅交易{ticker}，初始持有现金。\n买入（{group(execution.rules.entry)}）。'
                f'\n卖出（{group(execution.rules.exit)}）。\n开仓资金比例{number(position_pct)}%；'
                f'收盘止损{f"{number(stop)}%" if stop else "关闭"}；收盘止盈{f"{number(profit)}%" if profit else "关闭"}。'
                '\n日线收盘判断，下一交易日开盘成交。')
    return (f'Trade only {ticker}, starting in cash.\nBuy ({group(execution.rules.entry)}).'
            f'\nSell ({group(execution.rules.exit)}).\nPosition {number(position_pct)}%; '
            f'close-based stop loss {f"{number(stop)}%" if stop else "off"}; take profit {f"{number(profit)}%" if profit else "off"}.'
            '\nEvaluate at the daily close; fill at the next session open.')
