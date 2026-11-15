"""Check explicit table parameters against AI output, rather than accept template defaults."""
import re
import unicodedata
from app.services.analysis_service import ProviderError


def validate_volatility_goal(goal, proposal):
    text = unicodedata.normalize('NFKC', goal).replace('|', ' ')
    execution = proposal.execution
    allocation = execution.allocation
    if not allocation:
        raise ProviderError('AI未返回目标中的波动率动态仓位公式')
    errors = []
    def number(pattern):
        match = re.search(pattern, text, re.I)
        return float(match.group(1)) if match else None
    def check(expected, actual, label):
        if expected is not None and (actual is None or abs(expected-actual) > 1e-9):
            errors.append(label)
    sma = number(r'SMA\s*(\d+)')
    factor = number(r'SMA\s*\d+\s*[×*]\s*(\d+(?:\.\d+)?)')
    momentum = number(r'MOM(?:ENTUM)?\s*(\d+)')
    def matches(condition, name, period, coefficient, exiting=False):
        left, right = condition.left, condition.right
        direct, reverse = ('lte','gte') if exiting else ('gt','lt')
        def indicator(value):
            return getattr(value,'indicator',None) in ({'momentum','roc'} if name=='momentum' else {name}) and getattr(value,'period',None)==period and abs((getattr(value,'factor',None) or 1)-coefficient)<1e-9
        if name=='sma':
            return (getattr(left,'indicator',None)=='close' and (getattr(left,'factor',None) or 1)==1 and condition.operator==direct and indicator(right)) or (getattr(right,'indicator',None)=='close' and (getattr(right,'factor',None) or 1)==1 and condition.operator==reverse and indicator(left))
        return (indicator(left) and condition.operator==direct and getattr(right,'value',None)==0) or (indicator(right) and condition.operator==reverse and getattr(left,'value',None)==0)
    for name, period, coefficient in [('sma',sma,factor or 1),('momentum',momentum,1)]:
        if period is not None:
            for key, exiting in [('entry',False),('exit',True)]:
                group = getattr(execution.rules,key)
                if not any(matches(c,name,period,coefficient,exiting) for c in group.conditions):
                    errors.append(f'{"买入" if key=="entry" else "清仓"} {name.upper()}{int(period)}' + (f'×{coefficient}' if coefficient!=1 else ''))
    if sma is not None and momentum is not None and (execution.rules.entry.mode!='all' or execution.rules.exit.mode!='any'):
        errors.append('买入全部满足、退出任一满足')
    check(number(r'(?:历史波动率\s*|σ\s*[_{}]*)(\d+)'),allocation.period,'波动率周期')
    check(number(r'目标波动率\s*[:：]?\s*(\d+(?:\.\d+)?)\s*%'),allocation.targetVolPct,'目标波动率')
    check(number(r'最大[^\n,;]{0,12}?仓位\s*[:：]?\s*(\d+(?:\.\d+)?)\s*%'),proposal.max_single_pct,'最大仓位')
    check(number(r'最小[^\n,;]{0,12}?仓位\s*[:：]?\s*(\d+(?:\.\d+)?)\s*%'),allocation.minPositionPct,'最小仓位')
    check(number(r'再平衡阈值\s*[:：]?\s*(\d+(?:\.\d+)?)\s*%'),allocation.rebalanceThresholdPct,'再平衡阈值')
    for label, key in [('手续费','feeBps'),('滑点','slippageBps')]:
        expected=number(label+r'(?:假设)?\s*(?:单边)?\s*(\d+(?:\.\d+)?)\s*%')
        check(expected*100 if expected is not None else None,getattr(execution.environment,key,None),label)
    for label, actual in [('固定止损',execution.stop_loss_pct),('固定止盈',execution.take_profit_pct)]:
        if re.search(label+r'[^\n]{0,12}(?:不设置|关闭|无|0\s*%)',text):
            check(0,actual,label)
    if '总体标准差' in text:
        check(0,allocation.ddof,'总体标准差口径')
    elif '样本标准差' in text:
        check(1,allocation.ddof,'样本标准差口径')
    for label, start, end in [('数据周期','dataStartDate','dataEndDate'),('回测交易区间','startDate','endDate')]:
        match=re.search(label+r'\s*[:：]?\s*(\d{4}-\d{2}-\d{2})\s*(?:至|—|~|到)\s*(\d{4}-\d{2}-\d{2})',text)
        if match and (getattr(execution.environment,start,None)!=match.group(1) or getattr(execution.environment,end,None)!=match.group(2)):
            errors.append(label)
    if errors:
        raise ProviderError('AI未完整转换以下目标参数：'+'、'.join(errors)+'；请重新生成')
