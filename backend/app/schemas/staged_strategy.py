from typing import Literal
from pydantic import Field, FiniteFloat, model_validator
from app.schemas.strategy import StrictModel


class StagedPlan(StrictModel):
    version: Literal[1]
    maFast: int = Field(ge=2, le=200)
    maEntry: int = Field(ge=2, le=200)
    maLong: int = Field(ge=2, le=200)
    rsiPeriod: int = Field(ge=2, le=100)
    macdFast: int = Field(ge=2, le=100)
    macdSlow: int = Field(ge=3, le=200)
    macdSignal: int = Field(ge=2, le=100)
    volumePeriod: int = Field(ge=2, le=100)
    initialMinPct: FiniteFloat = Field(ge=1, le=100)
    initialMaxPct: FiniteFloat = Field(ge=1, le=100)
    initialPct: FiniteFloat = Field(ge=1, le=100)
    entryVolumeRatio: FiniteFloat = Field(ge=0, le=20)
    breakoutLower: FiniteFloat = Field(gt=0, le=1e9)
    breakoutUpper: FiniteFloat = Field(gt=0, le=1e9)
    confirmBars: int = Field(ge=1, le=20)
    breakoutVolumeRatio: FiniteFloat = Field(ge=0, le=20)
    addTargetPct: FiniteFloat = Field(ge=1, le=100)
    pullbackTolerancePct: FiniteFloat = Field(ge=0, le=20)
    pullbackMaxVolumeRatio: FiniteFloat = Field(ge=0, le=20)
    pullbackRsi: FiniteFloat = Field(ge=0, le=100)
    pullbackTargetPct: FiniteFloat = Field(ge=1, le=100)
    stopLossPct: FiniteFloat = Field(ge=0, le=100)
    lowLookback: int = Field(ge=2, le=200)
    stagnationBars: int = Field(ge=1, le=20)
    stagnationMaxChangePct: FiniteFloat = Field(ge=0, le=20)
    maResistanceTolerancePct: FiniteFloat = Field(ge=0, le=20)
    trimRsi: FiniteFloat = Field(ge=0, le=100)
    trimVolumeRatio: FiniteFloat = Field(ge=0, le=20)
    wickFraction: FiniteFloat = Field(ge=0, le=1)
    wickBodyRatio: FiniteFloat = Field(ge=0, le=10)
    trimFraction: FiniteFloat = Field(gt=0, le=1)
    clearVolumeRatio: FiniteFloat = Field(ge=0, le=20)
    maxChasePct: FiniteFloat = Field(ge=0, le=100)
    waitVolumeRatio: FiniteFloat = Field(ge=0, le=20)
    maxPositionPct: FiniteFloat = Field(ge=1, le=100)
    maxOrderPct: FiniteFloat = Field(ge=1, le=100)
    initialEnabled: bool
    breakoutEnabled: bool
    pullbackEnabled: bool
    trimMaEnabled: bool
    trimRsiEnabled: bool
    clearEnabled: bool
    emergencyExitAll: bool
    includeNews: bool
    reviewTurnover: bool
    assumptions: list[str] = Field(max_length=20)

    @model_validator(mode='after')
    def relationships(self):
        if self.macdFast >= self.macdSlow or self.maEntry >= self.maLong or self.breakoutLower >= self.breakoutUpper:
            raise ValueError('分批策略周期或区间关系无效')
        if not self.initialMinPct <= self.initialPct <= self.initialMaxPct:
            raise ValueError('首仓比例不在指定区间内')
        if max(self.initialMaxPct, self.addTargetPct, self.pullbackTargetPct, self.maxOrderPct) > self.maxPositionPct:
            raise ValueError('分批仓位超过单股上限')
        return self


def staged_warmup(plan):
    return max(plan.maFast, plan.maEntry, plan.maLong, plan.rsiPeriod + 1, plan.macdSlow + plan.macdSignal,
               plan.volumePeriod + 1, plan.lowLookback + 1, plan.stagnationBars + 1) + plan.confirmBars
