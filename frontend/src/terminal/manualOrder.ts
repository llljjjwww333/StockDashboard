import { validateStrategyConfig } from './backtest.ts';
import { portfolioSellable, type Portfolio } from './portfolio.ts';
import { quoteExecutionIssue } from './paperTrading.ts';
import type { Quote } from './types';

export function manualOrderDetails(p: Portfolio, ticker: string, side: 'buy' | 'sell', quantity: number, quote: Quote | undefined, now = new Date()) {
 const config=validateStrategyConfig(p.config),unit=p.market==='CRYPTO'?1e-8:p.market==='CN'?100:1;
 const price=quote?.price&&Number.isFinite(quote.price)&&quote.price>0?quote.price:0;
 const perShare=price*(1+(side==='buy'?1:-1)*config.slippageBps/10000)*(1+(side==='buy'?1:-1)*config.feeBps/10000);
 const maximum=side==='buy'?(perShare?Math.floor((p.cash+1e-8)/perShare/unit)*unit:0):(ticker?portfolioSellable(p,ticker,now):0);
 let error=ticker?quoteExecutionIssue(ticker,quote,now):'请选择标的';
 if(!error){
  if(!Number.isFinite(quantity)||quantity<=0||p.market!=='CRYPTO'&&!Number.isSafeInteger(quantity))error='请输入有效数量';
  else if(p.market==='CRYPTO'&&Math.abs(quantity*1e8-Math.round(quantity*1e8))>1e-5)error='币数量最多保留8位小数';
  else if(side==='buy'&&p.market!=='CRYPTO'&&quantity%unit!==0)error=`买入数量须为 ${unit} 股的整数倍`;
  else if(quantity>maximum)error=side==='buy'?'可用资金不足':maximum?'超出可卖数量':'暂无可卖持仓';
 }
 return {unit,maximum,amount:perShare&&Number.isFinite(quantity)&&quantity>0?perShare*quantity:null,error};
}
