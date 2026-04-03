from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import asyncio
import json
from app.services.stock_data_service import StockDataService

router = APIRouter()
stock_service = StockDataService()

# Store active connections
class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []
        self.subscriptions: dict[str, list[WebSocket]] = {}  # ticker -> list of connections
    
    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
    
    def disconnect(self, websocket: WebSocket):
        # Only remove if websocket is in the list
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        # Remove from all subscriptions
        for ticker, connections in self.subscriptions.items():
            if websocket in connections:
                connections.remove(websocket)
    
    async def subscribe(self, websocket: WebSocket, ticker: str):
        if ticker not in self.subscriptions:
            self.subscriptions[ticker] = []
        if websocket not in self.subscriptions[ticker]:
            self.subscriptions[ticker].append(websocket)
    
    async def unsubscribe(self, websocket: WebSocket, ticker: str):
        if ticker in self.subscriptions and websocket in self.subscriptions[ticker]:
            self.subscriptions[ticker].remove(websocket)
    
    async def send_personal_message(self, message: str, websocket: WebSocket):
        await websocket.send_text(message)
    
    async def broadcast_to_subscribers(self, ticker: str, message: str):
        if ticker in self.subscriptions:
            for connection in list(self.subscriptions[ticker]):
                try:
                    await connection.send_text(message)
                except Exception:
                    # Remove broken connection
                    self.disconnect(connection)

manager = ConnectionManager()

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
                    ticker = message["data"]["ticker"]
                    await manager.subscribe(websocket, ticker)
                    # Send initial data
                    stock_data = await stock_service.get_real_time_data(ticker)
                    await manager.send_personal_message(
                        json.dumps({
                            "type": "update",
                            "data": stock_data.model_dump()
                        }),
                        websocket
                    )
                elif message["type"] == "unsubscribe":
                    ticker = message["data"]["ticker"]
                    await manager.unsubscribe(websocket, ticker)
            except json.JSONDecodeError:
                await manager.send_personal_message(
                    json.dumps({"type": "error", "data": "Invalid JSON format"}),
                    websocket
                )
            except KeyError:
                await manager.send_personal_message(
                    json.dumps({"type": "error", "data": "Invalid message format"}),
                    websocket
                )
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# Background task to generate real-time updates
async def generate_stock_updates():
    while True:
        # Get all unique tickers being subscribed to
        tickers = list(manager.subscriptions.keys())

        if not tickers:
            await asyncio.sleep(2)
            continue

        updates = await asyncio.gather(
            *(stock_service.get_real_time_data(ticker) for ticker in tickers),
            return_exceptions=True,
        )

        for ticker, stock_data in zip(tickers, updates):
            if isinstance(stock_data, Exception):
                print(f"Error generating update for {ticker}: {stock_data}")
                continue

            await manager.broadcast_to_subscribers(
                ticker,
                json.dumps({
                    "type": "update",
                    "data": stock_data.model_dump()
                })
            )

        await asyncio.sleep(10)

# Start the background task
@router.on_event("startup")
async def startup_event():
    asyncio.create_task(generate_stock_updates())
