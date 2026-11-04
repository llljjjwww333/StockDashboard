from typing import Any, Literal
from pydantic import BaseModel, Field
from app.schemas.stock import StockDataPoint


class ProviderConfig(BaseModel):
    provider: str = Field(default="Custom", max_length=80)
    base_url: str = Field(min_length=8, max_length=500)
    model: str = Field(min_length=1, max_length=150)
    api_key: str = Field(default="", max_length=4096, repr=False)
    protocol: Literal["chat", "anthropic"] = "chat"


class ProviderTestRequest(BaseModel):
    settings: ProviderConfig


class AnalysisRequest(BaseModel):
    settings: ProviderConfig
    scope: Literal["chart", "news"]
    language: Literal["zh", "en"] = "zh"
    ticker: str = Field(default="", max_length=20, pattern=r"^[A-Za-z0-9.^-]*$")
    market: Literal["CN", "US"] = "US"
    period: Literal["1d", "5d", "1wk", "1mo", "3mo", "1y"] = "1mo"
    interval: Literal["1m", "5m", "15m", "30m", "1h", "1d"] = "1d"
    chart_type: Literal["line", "candles"] = "line"
    query: str = Field(default="", max_length=100)
    news_source: str = Field(default="ALL", max_length=80)


class ChartAnnotation(BaseModel):
    id: str
    index: int
    timestamp: str
    price: float
    kind: Literal["support", "resistance", "volume", "breakout", "reversal"]
    label: str
    detail: str


class TrendAnchor(BaseModel):
    timestamp: str
    price: float


class ChartTrendline(BaseModel):
    id: str
    kind: Literal["support", "resistance"]
    start: TrendAnchor
    end: TrendAnchor
    label: str
    detail: str


class MarketAnalysis(BaseModel):
    scope: str
    ticker: str
    period: str
    interval: str
    provider: str
    model: str
    analyzed_at: str
    summary: str
    outlook: str
    drivers: list[str]
    watch: list[str]
    annotations: list[ChartAnnotation]
    trendlines: list[ChartTrendline] = Field(default_factory=list)
    data: list[StockDataPoint]
    context: dict[str, Any]
