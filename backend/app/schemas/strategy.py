from typing import Literal
from datetime import datetime
from zoneinfo import ZoneInfo
from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, field_validator, model_validator
from app.schemas.analysis import AnalysisChartHistory, ProviderConfig


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class ConstantOperand(StrictModel):
    value: FiniteFloat = Field(ge=-1e12, le=1e12)


class DirectOperand(StrictModel):
    indicator: Literal["close", "open", "high", "low", "volume", "obv", "macd", "macd_signal"]
    factor: FiniteFloat | None = Field(default=None, gt=0, le=1000)


class PeriodOperand(StrictModel):
    indicator: Literal["sma", "ema", "rsi", "roc", "momentum", "atr_pct", "volume_ratio", "cci", "williams", "adx"]
    period: int = Field(ge=2, le=200)
    factor: FiniteFloat | None = Field(default=None, gt=0, le=1000)


class BandOperand(StrictModel):
    indicator: Literal["boll_upper", "boll_lower"]
    period: int = Field(ge=2, le=200)
    multiplier: FiniteFloat = Field(ge=.1, le=5)
    factor: FiniteFloat | None = Field(default=None, gt=0, le=1000)


class VolatilityAllocation(StrictModel):
    method: Literal['volatility_target']
    period: int = Field(ge=2, le=200)
    targetVolPct: FiniteFloat = Field(gt=0, le=100)
    minPositionPct: FiniteFloat = Field(ge=0, le=100)
    annualization: Literal[252, 365]
    ddof: Literal[0, 1] = 1
    rebalanceThresholdPct: FiniteFloat = Field(ge=0, le=100)


class DesignEnvironment(StrictModel):
    feeBps: FiniteFloat = Field(ge=0, le=100)
    slippageBps: FiniteFloat = Field(ge=0, le=100)
    startDate: str = Field(default='', pattern=r'^$|^\d{4}-\d{2}-\d{2}$')
    endDate: str = Field(default='', pattern=r'^$|^\d{4}-\d{2}-\d{2}$')
    dataStartDate: str = Field(default='', pattern=r'^$|^\d{4}-\d{2}-\d{2}$')
    dataEndDate: str = Field(default='', pattern=r'^$|^\d{4}-\d{2}-\d{2}$')


Operand = ConstantOperand | DirectOperand | PeriodOperand | BandOperand


class StrategyCondition(StrictModel):
    left: Operand
    operator: Literal["gt", "gte", "lt", "lte", "cross_above", "cross_below"]
    right: Operand

    @model_validator(mode='after')
    def compatible_operands(self):
        def dimension(value):
            if isinstance(value, ConstantOperand):
                return None
            name = value.indicator
            if name in {'close', 'open', 'high', 'low', 'sma', 'ema', 'boll_upper', 'boll_lower'}:
                return 'price'
            if name in {'macd', 'macd_signal'}:
                return 'macd'
            if name in {'roc', 'atr_pct'}:
                return 'percent'
            return name
        left, right = dimension(self.left), dimension(self.right)
        if left is not None and right is not None and left != right:
            raise ValueError('指标比较不匹配：不同类型的指标不能直接比较，应使用数值阈值或同类指标')
        return self


class StrategyGroup(StrictModel):
    mode: Literal["all", "any"]
    conditions: list[StrategyCondition] = Field(min_length=1, max_length=6)


class StrategyRules(StrictModel):
    entry: StrategyGroup
    exit: StrategyGroup


class StrategyRisk(StrictModel):
    position_pct: FiniteFloat = Field(ge=1, le=100)
    stop_loss_pct: FiniteFloat = Field(ge=0, le=100)
    take_profit_pct: FiniteFloat = Field(ge=0, le=1000)


class StrategyEvidenceUse(StrictModel):
    id: str = Field(min_length=1, max_length=20)
    reason: str = Field(min_length=1, max_length=240)


class StrategyProposal(StrictModel):
    name: str = Field(min_length=1, max_length=80)
    summary: str = Field(min_length=1, max_length=800)
    rules: StrategyRules
    risk: StrategyRisk
    evidence: list[StrategyEvidenceUse] = Field(min_length=1, max_length=8)


class StrategyGenerationRequest(BaseModel):
    settings: ProviderConfig
    ticker: str = Field(min_length=1, max_length=20, pattern=r"^[A-Za-z0-9.^-]+$")
    prompt: str = Field(min_length=1, max_length=16000)
    language: Literal["zh", "en"] = "zh"
    period: Literal["3mo", "1y"] = "1y"
    chart_history: AnalysisChartHistory
    include_news: bool = True
    include_quote: bool = True
    include_market: bool = True

    @field_validator("prompt")
    @classmethod
    def nonempty_prompt(cls, value):
        if not value.strip():
            raise ValueError("请输入策略目标")
        return value.strip()

    @model_validator(mode="after")
    def daily_history(self):
        if self.chart_history.price_type != "ohlc" or len(self.chart_history.data) < 20:
            raise ValueError("至少需要20条日线行情")
        dates = [point.timestamp[:10] for point in self.chart_history.data]
        today = datetime.now(ZoneInfo("Asia/Shanghai") if self.ticker[:1].isdigit() or self.ticker.upper().startswith(("SH", "SZ", "BJ")) else ZoneInfo("America/New_York")).date().isoformat()
        if len(set(dates)) != len(dates) or any(day >= today for day in dates):
            raise ValueError("请使用已完成日期的唯一日线数据")
        return self


class StrategyEvidence(StrictModel):
    id: str
    kind: Literal["history", "indicators", "quote", "market", "news"]
    title: str
    detail: str
    source: str
    timestamp: str


class GeneratedStrategy(StrictModel):
    ticker: str
    provider: str
    model: str
    generated_at: str
    proposal: StrategyProposal
    evidence: list[StrategyEvidence]
