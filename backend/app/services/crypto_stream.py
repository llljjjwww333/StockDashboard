"""One shared Binance market-data socket, with REST snapshots as the fallback."""
import asyncio
import json
import math
import time
from contextlib import suppress

import websockets

from app.services.crypto_market import crypto_market, is_crypto, iso


INTERVALS = {'1m', '5m', '15m', '30m', '1h', '1d', '1wk'}


class CryptoStream:
    def __init__(self, manager, service):
        self.manager, self.service = manager, service
        self.seen = {}
        self.sent = {}
        self.trade_prices = {}
        self.connected = False

    def streams(self):
        streams = {ticker.lower() + '@ticker' for ticker in self.manager.subscriptions if is_crypto(ticker)}
        for ticker, interval in self.manager.details.values():
            symbol = ticker.lower()
            streams.update({symbol + '@aggTrade', symbol + '@depth20@100ms',
                            symbol + '@kline_' + ('1w' if interval == '1wk' else interval)})
        return streams

    def healthy(self, ticker):
        return self.connected and time.monotonic() - self.seen.get(ticker, -1000) < 4

    async def handle(self, stream, data):
        ticker = stream.split('@')[0].upper()
        if ticker not in self.manager.subscriptions:
            return
        now = time.monotonic()
        if stream.endswith('@ticker'):
            row = {key: data[source] for key, source in {
                'symbol': 's', 'lastPrice': 'c', 'volume': 'v', 'quoteVolume': 'q',
                'priceChangePercent': 'P', 'priceChange': 'p', 'openPrice': 'o',
                'highPrice': 'h', 'lowPrice': 'l', 'closeTime': 'E',
            }.items()}
            quote = crypto_market.quote(row)
            trade = self.trade_prices.get(ticker)
            if trade and trade[0] > data.get('C', data['E']):
                quote.price = trade[1]
                quote.change = quote.price - quote.open_price
                quote.change_percent = quote.change / quote.open_price * 100
                quote.as_of = iso(max(trade[0], data['E']))
            self.seen[ticker] = now
            self.service.quote_cache[ticker] = (time.time(), quote)
            await self.manager.broadcast_to_subscribers(ticker, json.dumps({'type': 'update', 'data': quote.model_dump()}))
        elif '@aggTrade' in stream:
            stamp, price = int(data['T']), float(data['p'])
            previous = self.trade_prices.get(ticker)
            if not math.isfinite(price) or price <= 0 or (previous and stamp < previous[0]):
                return
            self.trade_prices[ticker] = (stamp, price)
            cached = self.service.quote_cache.get(ticker)
            if not cached or now - self.sent.get(ticker, -1000) < .1:
                return
            quote = cached[1].model_copy(update={'price': price, 'as_of': iso(stamp), 'stale': False,
                'fetched_at': iso(time.time() * 1000)})
            if quote.open_price:
                quote.change = price - quote.open_price
                quote.change_percent = quote.change / quote.open_price * 100
            self.service.quote_cache[ticker] = (time.time(), quote)
            self.sent[ticker] = now
            await self.manager.broadcast_to_subscribers(ticker, json.dumps({'type': 'update', 'data': quote.model_dump()}))
        elif '@depth' in stream:
            book = {side: [{'level': i + 1, 'price': float(p), 'volume': float(q)}
                           for i, (p, q) in enumerate(data[side][:10])] for side in ('bids', 'asks')}
            await self.manager.broadcast_detail(ticker, {'type': 'depth', 'data': {
                'ticker': ticker, 'book': book, 'sequence': data['lastUpdateId'], 'received_at': iso(time.time() * 1000)}})
        elif '@kline_' in stream:
            k = data['k']
            await self.manager.broadcast_detail(ticker, {'type': 'candle', 'data': {
                'ticker': ticker, 'interval': '1wk' if k['i'] == '1w' else k['i'],
                'event_time': data['E'], 'closed': k['x'], 'point': {
                    'timestamp': iso(k['t']), 'open': float(k['o']), 'high': float(k['h']),
                    'low': float(k['l']), 'close': float(k['c']), 'volume': float(k['v'])}}})

    async def run(self):
        failures = 0
        while True:
            if not self.streams():
                await asyncio.sleep(.25)
                continue
            try:
                async with websockets.connect('wss://data-stream.binance.vision/stream', open_timeout=12,
                        ping_interval=20, ping_timeout=20, close_timeout=3, max_queue=256) as socket:
                    self.connected = True
                    subscribed = set()
                    received = time.monotonic()
                    serial = 0
                    while True:
                        desired = self.streams()
                        if not desired:
                            break
                        for method, params in [('UNSUBSCRIBE', subscribed - desired), ('SUBSCRIBE', desired - subscribed)]:
                            if params:
                                serial += 1
                                await socket.send(json.dumps({'method': method, 'params': sorted(params), 'id': serial}))
                        subscribed = desired
                        # Remove inactive symbols so this process stays bounded across navigation.
                        active = set(self.manager.subscriptions)
                        self.trade_prices = {s: v for s, v in self.trade_prices.items() if s in active}
                        self.seen = {s: v for s, v in self.seen.items() if s in active}
                        self.sent = {s: v for s, v in self.sent.items() if s in active}
                        try:
                            payload = json.loads(await asyncio.wait_for(socket.recv(), .5))
                        except asyncio.TimeoutError:
                            if time.monotonic() - received > 15:
                                raise ConnectionError('Market stream silent')
                            continue
                        if 'stream' in payload:
                            received = time.monotonic()
                            failures = 0
                            with suppress(KeyError, TypeError, ValueError):
                                await self.handle(payload['stream'], payload['data'])
            except (OSError, websockets.WebSocketException, asyncio.TimeoutError):
                failures += 1
            finally:
                self.connected = False
                self.seen.clear()
            await asyncio.sleep(min(2 ** min(failures, 5), 30))
