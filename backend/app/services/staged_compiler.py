"""Compile explicitly specified staged MA/volume/RSI strategies without inventing model output."""
import re
from app.schemas.staged_strategy import StagedPlan


def compile_staged_goal(goal: str, market: str = 'CN'):
    if not re.search(r'分批|分档|加仓', goal) or not all(s in goal.upper() for s in ['MA', 'RSI', '量比']):
        return None
    number = r'(\d+(?:\.\d+)?)'

    def find(pattern, default=None):
        match = re.search(pattern, goal, re.I)
        return float(match.group(1)) if match else default

    band = re.search(r'突破\s*' + number + r'\s*[-—–至~～]\s*' + number, goal)
    initial = re.search(r'首仓\s*' + number + r'\s*%?\s*[-—–至~～]\s*' + number + r'\s*%', goal)
    add = find(r'加仓[至到]\s*' + number + r'\s*%')
    maximum = find(r'单股[^。；\n]{0,20}?不超过[^\d。；\n]{0,10}' + number + r'\s*%')
    per_order = find(r'单次[^。；\n]{0,10}?不超过\s*' + number + r'\s*%')
    stop = find(r'(?:跌破买入价|止损)[^\d。；\n]{0,6}' + number + r'\s*%')
    if not band or not initial or any(v is None for v in [add, maximum, per_order, stop]):
        return None
    periods = [int(n) for block in re.findall(r'MA\s*(\d+(?:/\d+)*)', goal, re.I) for n in block.split('/')]
    entry_ma = max(set(periods), key=periods.count) if periods else 20
    long_ma = max(periods) if periods else 60
    ratios = [float(n) for n in re.findall(r'量比\s*>\s*' + number, goal)]
    rsi_values = [float(n) for n in re.findall(r'RSI\s*>\s*' + number, goal, re.I)]
    low = float(initial.group(1)); high = float(initial.group(2))
    volume_period=int(find(r'量比(?:均量|回看|均量回看)?(?:周期)?(?:为|取|[:：])?\s*(\d+)\s*(?:日|交易日)',5))
    macd=re.search(r'MACD\s*[（(]?\s*(\d+)\s*[/,，]\s*(\d+)\s*[/,，]\s*(\d+)',goal,re.I)
    macd_periods=tuple(int(n) for n in macd.groups()) if macd else (12,26,9)
    assumptions = [
        f'首仓{low:g}%–{high:g}%取中值{(low+high)/2:g}%，可修改。',
        f'量比采用此前{volume_period}个交易日均量；量比=当日量/此前均量。MACD采用{macd_periods[0]}/{macd_periods[1]}/{macd_periods[2]}；未指定时使用上述解析起始值，可修改。',
        '放量突破/减仓采用量比≥1.2；缩量采用量比<1；均线回踩容差1%。',
        f'二次买点未给仓位，采用目标{add:g}%，同时受单次交易上限约束。',
        '滞涨定义为3个交易日绝对涨跌≤1%，且距长期均线≤1%。长上影要求上影占振幅≥50%、上影至少为实体2倍。',
        'MACD转正定义为DIF−DEA由≤0转>0，且大于前一日；RSI回升定义为从≤阈值上穿。',
        f'日收盘确认信号，下一交易日开盘执行；{stop:g}%止损相对持仓加权成交均价，按日收盘确认。',
        '每个加仓支路每轮持仓一次，减半的两个触发条件合并为一次减仓事件；受单次上限时分次完成，整手向下取可减数量，清仓后重置；退出优先于买入。普通单次交易受上限约束，止损/清仓一次退出。',
        'MA及前期低点动态计算；原文中的约值只作当时参考，不作为永久固定价格。',
        '现货数量支持小数币量，首仓按选定比例计算。' if market == 'CRYPTO' else 'A股首仓按100股整手选择落在首仓区间内、最接近选定比例的数量；无可行整手则等待，不突破上限。',
        '新闻用于实时复核，重大负面新闻可暂停新增买入；价格退出信号独立执行。',
    ]
    return StagedPlan.model_validate(dict(
        version=1, maFast=min(periods) if periods else 5, maEntry=entry_ma, maLong=long_ma,
        rsiPeriod=int(find(r'RSI\s*(\d+)\b', 14)), macdFast=macd_periods[0], macdSlow=macd_periods[1], macdSignal=macd_periods[2], volumePeriod=volume_period,
        initialMinPct=low, initialMaxPct=high, initialPct=(low+high)/2, entryVolumeRatio=ratios[0] if ratios else 1,
        breakoutLower=float(band.group(1)), breakoutUpper=float(band.group(2)), confirmBars=int(find(r'站稳\s*(\d+)\s*个?交易日',3)),
        breakoutVolumeRatio=1.2, addTargetPct=add, pullbackTolerancePct=1, pullbackMaxVolumeRatio=1,
        pullbackRsi=find(r'RSI[^。；\n]{0,8}?(?:回升过|上穿|回升至)\s*'+number,45), pullbackTargetPct=add,
        stopLossPct=stop, lowLookback=int(find(r'近\s*(\d+)\s*日低点',20)), stagnationBars=3,
        stagnationMaxChangePct=1, maResistanceTolerancePct=1, trimRsi=max(rsi_values) if rsi_values else 70,
        trimVolumeRatio=1.2, wickFraction=.5, wickBodyRatio=2, trimFraction=.5,
        clearVolumeRatio=ratios[-1] if len(ratios)>1 else 1.2, maxChasePct=find(r'MA\s*\d+上方\s*'+number+r'\s*%',10),
        waitVolumeRatio=1, maxPositionPct=maximum, maxOrderPct=per_order,
        initialEnabled=True, breakoutEnabled=True, pullbackEnabled=True, trimMaEnabled=True, trimRsiEnabled=True,
        clearEnabled=True, emergencyExitAll=True, includeNews='新闻' in goal or '公告' in goal,
        reviewTurnover='换手率' in goal, assumptions=assumptions,
    ))
