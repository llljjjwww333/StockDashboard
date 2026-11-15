import json
from datetime import date
from pathlib import Path


CALENDAR = json.loads((Path(__file__).resolve().parents[1] / "data" / "market_calendar.json").read_text(encoding="utf-8"))


def market_hours(market: str, day: date):
    calendar = CALENDAR["markets"][market]
    key = day.isoformat()
    if day.weekday() >= 5 or any(start <= key <= end for start, end in calendar["closures"]):
        return None
    return calendar["early_closes"].get(key, {"regular": 900, "late": 900} if market == "CN" else {"regular": 960, "late": 1200})
