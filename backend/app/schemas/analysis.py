from datetime import datetime, timezone
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, field_validator
from app.schemas.stock import FinanceNewsItem, StockDataPoint


class ProviderConfig(BaseModel):
    provider: str = Field(default="Custom", max_length=80)
    base_url: str = Field(min_length=8, max_length=500)
    model: str = Field(min_length=1, max_length=150)
    api_key: str = Field(default="", max_length=4096, repr=False)
    protocol: Literal["chat", "anthropic"] = "chat"


class ProviderTestRequest(BaseModel):
    settings: ProviderConfig


class AnalysisNewsItem(FinanceNewsItem):
    title: str = Field(min_length=1, max_length=512)
    summary: str = Field(max_length=512)
    published_at: str = Field(min_length=1, max_length=40)
    source: str = Field(min_length=1, max_length=128)
    market: str = Field(max_length=32)
    url: str | None = Field(default=None, max_length=1024)


class AnalysisChartPoint(StockDataPoint):
    model_config = ConfigDict(allow_inf_nan=False)
    timestamp: str = Field(min_length=10, max_length=40)
    open: float = Field(gt=0)
    high: float = Field(gt=0)
    low: float = Field(gt=0)
    close: float = Field(gt=0)
    volume: float = Field(ge=0)


ChartIndicator = Literal[
    "ma5", "ma10", "ma20", "ma60", "ema12", "ema26", "boll_mid", "boll_upper", "boll_lower",
    "rsi14", "macd", "macd_signal", "macd_histogram", "obv", "roc12", "atr14", "cci20", "kdj_k", "kdj_d", "kdj_j",
]


class AnalysisChartHistory(BaseModel):
    data: list[AnalysisChartPoint] = Field(min_length=2, max_length=2048)
    source: str | None = Field(default=None, max_length=100)
    price_type: Literal["ohlc", "snapshot"] = "ohlc"
    adjustment: str | None = Field(default=None, max_length=24)
    stale: bool = False
    indicators: dict[ChartIndicator, FiniteFloat | None] | None = None

    @field_validator("data")
    @classmethod
    def validate_points(cls, points):
        previous = None
        for point in points:
            timestamp = datetime.fromisoformat(point.timestamp)
            if timestamp.tzinfo is None:
                timestamp = timestamp.replace(tzinfo=timezone.utc)
            if previous is not None and timestamp <= previous:
                raise ValueError("Chart timestamps must be unique and increasing")
            if point.low > min(point.open, point.close) or point.high < max(point.open, point.close):
                raise ValueError("Chart prices do not match the bar range")
            previous = timestamp
        return points


class AnalysisRequest(BaseModel):
    settings: ProviderConfig
    scope: Literal["chart", "news"]
    language: Literal["zh", "en"] = "zh"
    ticker: str = Field(default="", max_length=20, pattern=r"^[A-Za-z0-9.^-]*$")
    market: Literal["CN", "US", "CRYPTO"] = "US"
    period: Literal["1d", "5d", "1wk", "1mo", "3mo", "1y"] = "1mo"
    interval: Literal["1m", "5m", "15m", "30m", "1h", "1d"] = "1d"
    chart_type: Literal["line", "candles"] = "line"
    chart_history: AnalysisChartHistory | None = None
    query: str = Field(default="", max_length=100)
    news_source: str = Field(default="ALL", max_length=80)
    news_items: list[AnalysisNewsItem] | None = Field(default=None, max_length=24)


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
