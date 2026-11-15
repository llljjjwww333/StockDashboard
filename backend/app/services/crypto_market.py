"""Binance public spot market data. No account credentials or trading endpoints."""
import asyncio
import json
import gzip
import math
import re
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from app.schemas.stock import StockDataPoint, StockHistoryResponse, StockUpdate, OrderBook, BookLevel

UTC = timezone.utc
NAMES = {'BTC': 'Bitcoin · 比特币', 'ETH': 'Ethereum · 以太坊', 'SOL': 'Solana', 'BNB': 'BNB', 'XRP': 'XRP', 'DOGE': 'Dogecoin · 狗狗币', 'ADA': 'Cardano', 'AVAX': 'Avalanche', 'LINK': 'Chainlink', 'SUI': 'Sui'}


def is_crypto(ticker):
    return bool(re.fullmatch(r'[A-Z0-9]{2,16}USDT', ticker or ''))


def iso(ms):
    return datetime.fromtimestamp(float(ms) / 1000, UTC).isoformat()


class CryptoMarket:
    def __init__(self, fetch=None):
        self.fetch = fetch or self._fetch
        self.cache = {}
        self.locks = {}

    @staticmethod
    def _fetch(path, params):
        url = 'https://data-api.binance.vision/api/v3/' + path + '?' + urllib.parse.urlencode(params)
        request = urllib.request.Request(url, headers={'User-Agent': 'ZPBoard/1.0', 'Accept': 'application/json', 'Accept-Encoding': 'gzip'})
        with urllib.request.urlopen(request, timeout=12) as response:
            body = response.read()
            if response.headers.get('Content-Encoding') == 'gzip':
                body = gzip.decompress(body)
            return json.loads(body)

    async def _cached(self, key, ttl, load, max_stale=0):
        cached = self.cache.get(key)
        if cached and time.time() - cached[0] < ttl:
            return cached[1]
        async with self.locks.setdefault(key, asyncio.Lock()):
            cached = self.cache.get(key)
            if cached and time.time() - cached[0] < ttl:
                return cached[1]
            try:
                result = await load()
            except Exception:
                if cached and max_stale and time.time() - cached[0] < max_stale:
                    return cached[1].model_copy(update={'stale': True})
                raise
            if len(self.cache) > 512:
                oldest = min(self.cache, key=lambda k: self.cache[k][0])
                self.cache.pop(oldest, None)
            self.cache[key] = (time.time(), result)
            return result

    async def symbols(self):
        async def load():
            payload = await asyncio.to_thread(self.fetch, 'exchangeInfo', {'symbolStatus': 'TRADING', 'showPermissionSets': 'false'})
            return {s['symbol']: s for s in payload['symbols'] if s.get('quoteAsset') == 'USDT' and s.get('status') == 'TRADING' and s.get('isSpotTradingAllowed', True)}
        return await self._cached('symbols', 3600, load)

    async def tickers(self):
        async def load():
            rows = await asyncio.to_thread(self.fetch, 'ticker/24hr', {'type': 'FULL'})
            fetched = datetime.now(UTC).isoformat()
            return {r['symbol']: {**r, '_fetched_at': fetched} for r in rows if is_crypto(r.get('symbol')) and float(r.get('lastPrice', 0)) > 0}
        return await self._cached('tickers', 15, load)

    def quote(self, row):
        symbol = row['symbol']; base = symbol[:-4]
        book = self.cache.get('depth:' + symbol)
        return StockUpdate(ticker=symbol, name=NAMES.get(base, base) + ' / USDT',
            price=float(row['lastPrice']), volume=float(row['volume']), amount=float(row['quoteVolume']),
            change_percent=float(row['priceChangePercent']), change=float(row['priceChange']),
            open_price=float(row['openPrice']), high_price=float(row['highPrice']), low_price=float(row['lowPrice']),
            previous_close=float(row['openPrice']), source='Binance Spot',
            as_of=iso(row['closeTime']), fetched_at=row.get('_fetched_at', datetime.now(UTC).isoformat()),
            delay_note='24小时滚动涨跌；USDT计价；日线UTC切分',
            order_book=book[1] if book and time.time() - book[0] < 10 else None)

    async def quotes(self, symbols):
        symbols = sorted(set(symbols))
        async def load():
            params = {'symbol': symbols[0]} if len(symbols) == 1 else {'symbols': json.dumps(symbols, separators=(',', ':'))}
            payload = await asyncio.to_thread(self.fetch, 'ticker/24hr', params)
            fetched = datetime.now(UTC).isoformat()
            return {r['symbol']: {**r, '_fetched_at': fetched} for r in (payload if isinstance(payload, list) else [payload])}
        rows = await self._cached('quotes:' + ','.join(symbols), 2, load)
        return {s: self.quote(rows[s]) for s in symbols if s in rows}

    async def depth(self, symbol):
        async def load():
            row = await asyncio.to_thread(self.fetch, 'depth', {'symbol': symbol, 'limit': 20})
            return OrderBook(**{side: [BookLevel(level=i+1, price=float(p), volume=float(q)) for i, (p, q) in enumerate(row[side][:10])] for side in ['bids', 'asks']})
        return await self._cached('depth:' + symbol, 2, load)

    async def latest(self, symbol):
        quotes = await self.quotes([symbol])
        if symbol not in quotes:
            raise ValueError('交易对不存在或当前不可交易')
        quote = quotes[symbol]
        try:
            quote.order_book = await self.depth(symbol)
        except Exception:
            pass
        return quote

    async def search(self, query):
        query = query.strip().upper().replace('/', '').replace('-', '').replace(' ', '')
        if not query:
            return []
        aliases = {'比特币': 'BTC', '以太坊': 'ETH', '狗狗币': 'DOGE'}
        query = aliases.get(query, query)
        symbols = await self.symbols()
        rows = [s for s in symbols.values() if query in s['symbol'] or query in NAMES.get(s['baseAsset'], '').upper()]
        rows.sort(key=lambda s: (s['baseAsset'] != query and s['symbol'] != query, len(s['symbol']), s['symbol']))
        return [{'ticker': s['symbol'], 'name': NAMES.get(s['baseAsset'], s['baseAsset']) + ' / USDT', 'market': 'CRYPTO'} for s in rows[:30]]

    async def history(self, symbol, period, interval):
        if not is_crypto(symbol):
            raise ValueError('无效USDT交易对')
        days = {'1d': 1, '5d': 5, '1mo': 32, '3mo': 93, '1y': 366}.get(period)
        units = {'1m': 60000, '5m': 300000, '15m': 900000, '30m': 1800000, '1h': 3600000, '1d': 86400000, '1wk': 604800000}
        api_interval = '1w' if interval == '1wk' else interval
        if days is None or interval not in units:
            raise ValueError('不支持的行情周期')
        key = f'history:{symbol}:{period}:{interval}'
        async def load():
            end = int(time.time()*1000)
            step = units[interval]
            start = (end - days*86400000) // step * step
            chunks = list(range(start, end, step*1000))
            if len(chunks) > 12:
                raise ValueError('请求K线过多，请选更大的K线周期')
            semaphore = asyncio.Semaphore(4)
            async def page(begin):
                async with semaphore:
                    return await asyncio.to_thread(self.fetch, 'klines', {'symbol': symbol, 'interval': api_interval, 'startTime': begin, 'endTime': min(end, begin+step*1000-1), 'limit': 1000})
            batches = await asyncio.gather(*(page(begin) for begin in chunks))
            rows = {int(row[0]): row for batch in batches for row in batch}
            points = []
            for stamp, row in sorted(rows.items()):
                values = [float(row[i]) for i in [1, 2, 3, 4, 5]]
                if not all(math.isfinite(x) and x >= 0 for x in values) or min(values[:4]) <= 0:
                    raise ValueError('K线包含无效价格')
                points.append(StockDataPoint(timestamp=iso(stamp), open=values[0], high=values[1], low=values[2], close=values[3], volume=values[4]))
            if not points:
                raise ValueError('该交易对没有可用历史')
            return StockHistoryResponse(ticker=symbol, data=points, source='Binance Spot', interval=interval, price_type='ohlc', adjustment='none', fetched_at=datetime.now(UTC).isoformat(), as_of=points[-1].timestamp)
        return await self._cached(key, 8 if period in {'1d', '5d'} else 45, load, max_stale=900)

    async def overview(self):
        rows, symbols = await asyncio.gather(self.tickers(), self.symbols())
        rows = [r for s, r in rows.items() if s in symbols]
        def present(r):
            return {**self.quote(r).model_dump(), 'sector': r['symbol'][:-4]}
        active = sorted(rows, key=lambda r: float(r['quoteVolume']), reverse=True)
        changes = sorted(rows, key=lambda r: float(r['priceChangePercent']), reverse=True)
        up = sum(float(r['priceChangePercent']) > 0 for r in rows)
        down = sum(float(r['priceChangePercent']) < 0 for r in rows)
        lookup = {r['symbol']: r for r in rows}
        return {'market': 'CRYPTO', 'indices': [present(lookup[s]) for s in ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'] if s in lookup],
            'sectors': [present(r) for r in active[:16]], 'active': [present(r) for r in active[:20]],
            'leaders': [present(r) for r in changes[:10]], 'laggards': [present(r) for r in changes[-10:][::-1]],
            'breadth': {'advancers': up, 'decliners': down, 'flat': len(rows)-up-down, 'total': len(rows)},
            'summary': {'market': 'CRYPTO', 'mode': 'spot_usdt', 'breadth_ratio': up/max(len(rows), 1)},
            'updated_at': datetime.now(UTC).isoformat(), 'source': 'Binance Spot · USDT交易对 · 24h', 'stale': False}

    async def news(self, limit):
        from app.services.crypto_news import crypto_news
        return await crypto_news.get(limit)


crypto_market = CryptoMarket()
