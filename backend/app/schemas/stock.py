from pydantic import BaseModel
from typing import List, Dict, Any

class StockDataPoint(BaseModel):
    timestamp: str
    open: float
    high: float
    low: float
    close: float
    volume: int

class StockHistoryResponse(BaseModel):
    ticker: str
    data: List[StockDataPoint]

class StockUpdate(BaseModel):
    ticker: str
    price: float
    volume: int
    change_percent: float
    change: float | None = None
    open_price: float | None = None
    high_price: float | None = None
    low_price: float | None = None
    previous_close: float | None = None
    amount: float | None = None
    turnover_rate: float | None = None
    amplitude_percent: float | None = None

class WebSocketMessage(BaseModel):
    type: str  # 'subscribe' or 'update'
    data: Dict[str, Any]
