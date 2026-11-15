from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import asyncio
import json
import os
import re
import time
from datetime import datetime
from zoneinfo import ZoneInfo
from contextlib import suppress
from app.services.runtime import stock_service
from app.services.market_calendar import market_hours
from app.services.crypto_stream import CryptoStream, INTERVALS
from app.services.crypto_market import is_crypto

router = APIRouter()


# Store active connections
class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []
        self.subscriptions: dict[str, list[WebSocket]] = {}  # ticker -> list of connections
        self.details: dict[WebSocket, tuple[str, str]] = {}

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.details.pop(websocket, None)
        # Only remove if websocket is in the list
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        # Remove from all subscriptions
        for ticker, connections in list(self.subscriptions.items()):
            if websocket in connections:
                connections.remove(websocket)
            if not connections:
                del self.subscriptions[ticker]

    async def subscribe(self, websocket: WebSocket, ticker: str):
        if ticker not in self.subscriptions:
            self.subscriptions[ticker] = []
        if websocket not in self.subscriptions[ticker]:
            self.subscriptions[ticker].append(websocket)

    async def unsubscribe(self, websocket: WebSocket, ticker: str):
        if self.details.get(websocket, (None,))[0] == ticker:
            self.details.pop(websocket, None)
        if ticker in self.subscriptions and websocket in self.subscriptions[ticker]:
            self.subscriptions[ticker].remove(websocket)
            if not self.subscriptions[ticker]:
                del self.subscriptions[ticker]

    async def send_personal_message(self, message: str, websocket: WebSocket):
        await websocket.send_text(message)

    async def broadcast_to_subscribers(self, ticker: str, message: str):
        if ticker in self.subscriptions:
            for connection in list(self.subscriptions[ticker]):
                try:
                    await asyncio.wait_for(connection.send_text(message), timeout=1)
                except Exception:
                    # Remove broken connection
                    self.disconnect(connection)

    async def broadcast_detail(self, ticker, message):
        encoded = json.dumps(message)
        for connection, detail in list(self.details.items()):
            if detail[0] == ticker and (message['type'] != 'candle' or message['data']['interval'] == detail[1]):
                try:
                    await asyncio.wait_for(connection.send_text(encoded), timeout=1)
                except Exception:
                    self.disconnect(connection)

manager = ConnectionManager()
crypto_stream = CryptoStream(manager, stock_service)

@router.websocket("/stock-updates")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)

    try:
        while True:
            # Wait for message from client
            data = await websocket.receive_text()
            try:
                message = json.loads(data)
                if message["type"] == "subscribe":
                    ticker = message["data"]["ticker"].strip().upper()
                    if not re.fullmatch(r"[A-Z0-9^][A-Z0-9.^-]{0,19}", ticker):
                        raise ValueError("Invalid ticker")
                    current = sum(websocket in connections for connections in manager.subscriptions.values())
                    if current >= 100 and websocket not in manager.subscriptions.get(ticker, []):
                        raise ValueError("Maximum 100 subscriptions per connection")
                    await manager.subscribe(websocket, ticker)
                    cached = stock_service.quote_cache.get(ticker)
                    if cached and time.time() - cached[0] < stock_service.quote_stale_ttl_seconds:
                        await manager.send_personal_message(json.dumps({
                            "type": "update", "data": cached[1].model_copy(update={
                                "stale": time.time() - cached[0] >= refresh_interval([ticker]) + 6,
                            }).model_dump(),
                        }), websocket)
                    # The shared feed batches new subscriptions on its next tick.
                elif message["type"] == "unsubscribe":
                    ticker = message["data"]["ticker"].strip().upper()
                    await manager.unsubscribe(websocket, ticker)
                elif message["type"] == "ping":
                    await manager.send_personal_message('{"type":"pong"}', websocket)
                elif message['type'] == 'detail':
                    ticker = message['data'].get('ticker')
                    interval = message['data'].get('interval', '1m')
                    if ticker is None:
                        manager.details.pop(websocket, None)
                    elif is_crypto(ticker) and interval in INTERVALS and websocket in manager.subscriptions.get(ticker, []):
                        manager.details[websocket] = (ticker, interval)
                    else:
                        raise ValueError('Invalid detail subscription')
            except json.JSONDecodeError:
                await manager.send_personal_message(
                    json.dumps({"type": "error", "data": "Invalid JSON format"}),
                    websocket
                )
            except (KeyError, TypeError, AttributeError, ValueError):
                await manager.send_personal_message(
                    json.dumps({"type": "error", "data": "Invalid message format"}),
                    websocket
                )
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(websocket)

def refresh_interval(tickers: list[str]) -> float:
    """Use exchange holidays and close times while keeping a short opening/closing buffer."""
    if any(stock_service.get_stock_market(ticker) == "CRYPTO" for ticker in tickers):
        return max(1.0, min(float(os.getenv("QUOTE_REFRESH_SECONDS", "2")), 30.0))
    active = False
    for market, timezone in (("CN", "Asia/Shanghai"), ("US", "America/New_York")):
        if not any(stock_service.get_stock_market(ticker) == market for ticker in tickers):
            continue
        now = datetime.now(ZoneInfo(timezone))
        minutes = now.hour * 60 + now.minute
        hours = market_hours(market, now.date())
        if hours is None:
            continue
        if market == "CN":
            active |= 9 * 60 + 15 <= minutes <= 11 * 60 + 35 or 12 * 60 + 55 <= minutes <= 15 * 60 + 10
        else:
            active |= 9 * 60 + 25 <= minutes <= hours["regular"] + 5
    configured = max(1.0, min(float(os.getenv("QUOTE_REFRESH_SECONDS", "2")), 30.0))
    return configured if active else 30.0


def due_quotes(tickers: list[str], last_refresh: dict[str, float], now: float) -> list[str]:
    intervals = {}
    requested = []
    for ticker in tickers:
        market = stock_service.get_stock_market(ticker)
        if market not in intervals:
            intervals[market] = refresh_interval([ticker])
        if ticker not in last_refresh or now - last_refresh[ticker] >= intervals[market]:
            requested.append(ticker)
    return requested


async def generate_stock_updates():
    last_refresh: dict[str, float] = {}
    while True:
        tickers = list(manager.subscriptions)
        if not tickers:
            last_refresh.clear()
            await asyncio.sleep(0.25)
            continue
        current = set(tickers)
        last_refresh = {ticker: refreshed for ticker, refreshed in last_refresh.items() if ticker in current}
        started = time.monotonic()
        requested = [ticker for ticker in due_quotes(tickers, last_refresh, started) if not crypto_stream.healthy(ticker)]
        if not requested:
            await asyncio.sleep(0.25)
            continue
        try:
            batches = await asyncio.gather(*(
                stock_service.get_quote_batch(requested[index:index + 100])
                for index in range(0, len(requested), 100)
            ))
            updates = {ticker: quote for batch in batches for ticker, quote in batch.items()}
            for ticker in requested:
                quote = updates.get(ticker)
                message = {"type": "update", "data": quote.model_dump()} if quote else {
                    "type": "error", "data": {"ticker": ticker, "message": "行情源暂不可用"},
                }
                await manager.broadcast_to_subscribers(ticker, json.dumps(message))
        except Exception as exc:
            print(f"Quote feed error: {type(exc).__name__}: {exc}")
        last_refresh.update({ticker: started for ticker in requested})
        await asyncio.sleep(0.25)


feed_task: asyncio.Task | None = None
crypto_task: asyncio.Task | None = None


@router.on_event("startup")
async def startup_event():
    global feed_task, crypto_task
    feed_task = asyncio.create_task(generate_stock_updates())
    crypto_task = asyncio.create_task(crypto_stream.run())


@router.on_event("shutdown")
async def shutdown_event():
    for task in (feed_task, crypto_task):
        if task:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
