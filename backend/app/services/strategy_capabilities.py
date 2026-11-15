import re

UNSUPPORTED = [
    (r'分批|分档|加仓|减半|半仓', '分批建仓、加仓或减半仓'),
    (r'(站稳|连续|持续).{0,8}[\d一二三四五六七八九十]+\s*个?\s*(交易日|日|天)', '连续多日确认'),
    (r'(近|前|过去)\s*\d+\s*个?\s*(日|交易日).{0,3}(低点|最低|高点|最高)', '滚动区间高低点'),
    (r'MACD.{0,8}(柱|柱状).{0,12}(放大|扩大|缩小)', 'MACD柱变化幅度'),
    (r'MA\s*\d+.{0,6}(上方|下方).{0,6}[%％]', '相对均线的百分比距离'),
    (r'长上影|滞涨', '长上影或滞涨形态'),
    (r'换手率', '历史换手率指标'),
]


def strategy_capability_issues(goal):
    text = re.sub(r'(不|无需|禁止)加仓', '', goal)
    return [label for pattern, label in UNSUPPORTED if re.search(pattern, text, re.I)]
