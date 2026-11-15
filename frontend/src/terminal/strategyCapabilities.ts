const unsupported: [RegExp, string][] = [
  [/分批|分档|加仓|减半|半仓/, '分批建仓、加仓或减半仓：需要生成分批仓位计划'],
  [/(站稳|连续|持续).{0,8}[\d一二三四五六七八九十]+\s*个?\s*(交易日|日|天)/, '连续多日确认：需填入连续站稳交易日数'],
  [/(近|前|过去)\s*\d+\s*个?\s*(日|交易日).{0,3}(低点|最低|高点|最高)/, '滚动区间高低点：需生成滚动高低点条件'],
  [/MACD.{0,8}(柱|柱状).{0,12}(放大|扩大|缩小)/i, 'MACD柱变化幅度：需生成MACD柱的时序条件'],
  [/MA\s*\d+.{0,6}(上方|下方).{0,6}[%％]/i, '相对均线的百分比距离：需生成相对均线的百分比条件'],
  [/长上影|滞涨/, '长上影或滞涨：需给出形态的可执行判定参数'],
  [/换手率/, '换手率：需设置复核参数'],
];

export function strategyCapabilityIssues(goal: string) {
  // Detect unsupported requirements only; natural-language text never creates orders.
  const text = goal.replace(/(不|无需|禁止)加仓/g, '');
  return unsupported.filter(([pattern], index) => !(index === 0 && volatilityAllocationGoal(text) && !/分批|分档|减半|半仓/.test(text)) && pattern.test(text)).map(([, message]) => message);
}

export const volatilityAllocationGoal = (goal: string) => /目标波动率|target\s*volatility|\d+(?:\.\d+)?\s*[%％]\s*\/\s*[σ\\]/i.test(goal);
