from pydantic import BaseModel, Field
from typing import List, Dict, Any

class StockDataPoint(BaseModel):
    timestamp: str
    open: float
    high: float
    low: float
    close: float
    volume: float
    average_price: float | None = None

class StockHistoryResponse(BaseModel):
    ticker: str
    data: List[StockDataPoint]
    source: str | None = None
    as_of: str | None = None
    fetched_at: str | None = None
    stale: bool = False
    interval: str | None = None
    price_type: str = "ohlc"
    adjustment: str | None = None
    reference_price: float | None = None

class BookLevel(BaseModel):
    level: int
    price: float
    volume: float

class OrderBook(BaseModel):
    bids: List[BookLevel]
    asks: List[BookLevel]

class StockUpdate(BaseModel):
    ticker: str
    name: str | None = None
    price: float
    volume: float
    change_percent: float
    change: float | None = None
    open_price: float | None = None
    high_price: float | None = None
    low_price: float | None = None
    previous_close: float | None = None
    amount: float | None = None
    turnover_rate: float | None = None
    volume_ratio: float | None = None
    pe_ratio: float | None = None
    pb_ratio: float | None = None
    market_cap: float | None = None
    amplitude_percent: float | None = None
    source: str | None = None
    as_of: str | None = None
    fetched_at: str | None = None
    stale: bool = False
    delay_note: str | None = None
    order_book: OrderBook | None = None

class WebSocketMessage(BaseModel):
    type: str  # 'subscribe' or 'update'
    data: Dict[str, Any]


class FinanceNewsItem(BaseModel):
    id: str | None = None
    language: str | None = None
    tickers: List[str] = Field(default_factory=list)
    topic: str | None = None
    title: str
    summary: str
    published_at: str
    source: str
    url: str | None = None
    market: str


class FinanceNewsSource(BaseModel):
    name: str
    language: str
    status: str
    item_count: int
    updated_at: str | None = None


class FinanceNewsResponse(BaseModel):
    market: str
    updated_at: str
    keywords: List[str]
    items: List[FinanceNewsItem]
    stale: bool = False
    sources: List[FinanceNewsSource] = Field(default_factory=list)


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
