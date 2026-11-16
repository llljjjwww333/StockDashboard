import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formatTradingQuantity,formatTradingPrice,formatTradingFee} from '../src/lib/tradingNumber.ts';

test('coin quantity and small fees remain visible instead of being rounded to zero',()=>{
 assert.equal(formatTradingQuantity(.001,'zh-CN'),'0.001');
 assert.equal(formatTradingQuantity(.00000001,'en-US'),'0.00000001');
 assert.equal(formatTradingQuantity(1234.56789,'en-US'),'1,234.56789');
 assert.equal(formatTradingFee('BTCUSDT',.00000012,'en-US'),'0.00000012');
 assert.equal(formatTradingFee('BTCUSDT',.000000001,'en-US'),'<0.00000001');
 assert.equal(formatTradingFee('BTCUSDT',0,'en-US'),'0');
});
test('execution price preserves small crypto prices while normal prices retain their precision',()=>{
 assert.equal(formatTradingPrice('BTCUSDT',65432.12,'en-US'),'65,432.12');
 assert.equal(formatTradingPrice('SHIBUSDT',.00001867,'en-US'),'0.00001867');
 assert.equal(formatTradingPrice('TINYUSDT',.0000000001,'en-US'),'0.000000000100');
});

test('USDT amounts and fees retain quote precision above one cent',()=>{
 assert.equal(formatTradingFee('BTCUSDT',.018688674,'en-US'),'0.01868867');
 assert.equal(formatTradingFee('BTCUSDT',12.3456789,'en-US'),'12.3456789');
 assert.equal(formatTradingFee('AAPL',12.3456789,'en-US'),'12.35');
});
