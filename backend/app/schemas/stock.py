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

class WebSocketMessage(BaseModel):
    type: str  # 'subscribe' or 'update'
    data: Dict[str, Any]
