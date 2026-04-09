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


class FinanceNewsItem(BaseModel):
    title: str
    summary: str
    published_at: str
    source: str
    url: str | None = None
    market: str


class FinanceNewsResponse(BaseModel):
    market: str
    updated_at: str
    keywords: List[str]
    items: List[FinanceNewsItem]


class AiProviderSettings(BaseModel):
    provider: str
    base_url: str
    model: str
    api_key: str


class FinanceNewsAiRequest(BaseModel):
    settings: AiProviderSettings
    language: str
    items: List[FinanceNewsItem]


class FinanceNewsAiResponse(BaseModel):
    provider: str
    model: str
    language: str
    analyzed_at: str
    summary: str
    keywords: List[str]


class AiContextAnalysisRequest(BaseModel):
    settings: AiProviderSettings
    language: str
    context_type: str
    payload: Dict[str, Any]


class AiContextAnalysisResponse(BaseModel):
    provider: str
    model: str
    language: str
    context_type: str
    analyzed_at: str
    title: str
    summary: str
    sentiment: str
    signals: List[str]
    risks: List[str]
