from __future__ import annotations

import asyncio
import json
import os
import random
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import akshare as ak

from app.schemas.stock import StockDataPoint, StockHistoryResponse, StockUpdate


@dataclass(frozen=True)
class PeriodSpec:
    history_window_days: int
    default_interval: str
    fallback_points: int
    fallback_step_minutes: int
    yfinance_period: str


PERIOD_SPECS: dict[str, PeriodSpec] = {
    "1d": PeriodSpec(2, "5m", 78, 5, "5d"),
    "1wk": PeriodSpec(10, "30m", 65, 30, "1mo"),
    "1mo": PeriodSpec(45, "1d", 22, 24 * 60, "3mo"),
    "3mo": PeriodSpec(120, "1d", 66, 24 * 60, "6mo"),
    "1y": PeriodSpec(400, "1wk", 52, 7 * 24 * 60, "2y"),
}


class StockDataService:
    def __init__(self) -> None:
        self.us_sector_map = {
            "XLK": "Technology",
            "XLF": "Financials",
            "XLV": "Health Care",
            "XLY": "Consumer Discretionary",
            "XLI": "Industrials",
            "XLP": "Consumer Staples",
            "XLE": "Energy",
            "XLB": "Materials",
            "XLU": "Utilities",
            "XLRE": "Real Estate",
            "XLC": "Communication Services",
        }
        self.market_hotspot_universe = {
            "US": [
                {"ticker": "SPY", "name": "SPDR S&P 500 ETF"},
                {"ticker": "QQQ", "name": "Invesco QQQ Trust"},
                {"ticker": "DIA", "name": "SPDR Dow Jones ETF"},
                {"ticker": "IWM", "name": "iShares Russell 2000 ETF"},
                {"ticker": "XLK", "name": "Technology"},
                {"ticker": "XLF", "name": "Financials"},
                {"ticker": "XLV", "name": "Health Care"},
                {"ticker": "XLY", "name": "Consumer Discretionary"},
                {"ticker": "XLI", "name": "Industrials"},
                {"ticker": "XLP", "name": "Consumer Staples"},
                {"ticker": "XLE", "name": "Energy"},
                {"ticker": "XLB", "name": "Materials"},
                {"ticker": "XLU", "name": "Utilities"},
                {"ticker": "XLRE", "name": "Real Estate"},
                {"ticker": "XLC", "name": "Communication Services"},
                {"ticker": "^VIX", "name": "CBOE Volatility Index"},
            ],
            "CN": [
                {"ticker": "510300", "name": "CSI 300 ETF"},
                {"ticker": "510500", "name": "CSI 500 ETF"},
                {"ticker": "159915", "name": "ChiNext ETF"},
                {"ticker": "159949", "name": "STAR 50 ETF"},
                {"ticker": "600519", "name": "Kweichow Moutai"},
                {"ticker": "601318", "name": "Ping An"},
                {"ticker": "000858", "name": "Wuliangye"},
                {"ticker": "600036", "name": "China Merchants Bank"},
                {"ticker": "601899", "name": "Zijin Mining"},
                {"ticker": "600031", "name": "Sany Heavy Industry"},
                {"ticker": "300033", "name": "Tonghuashun"},
                {"ticker": "300059", "name": "East Money"},
            ],
        }
        self.market_hotspot_indices = {
            "US": ["SPY", "QQQ", "DIA", "IWM"],
            "CN": ["510300", "510500", "159915", "159949"],
        }
        self.industry_map = {
            "AAPL": "Technology",
            "MSFT": "Technology",
            "GOOGL": "Technology",
            "AMZN": "Consumer Cyclical",
            "META": "Technology",
            "TSLA": "Consumer Cyclical",
            "JPM": "Financial Services",
            "V": "Financial Services",
            "JNJ": "Healthcare",
            "PFE": "Healthcare",
            "600519": "Consumer Staples",
            "601318": "Financial Services",
            "000858": "Consumer Staples",
            "600036": "Financial Services",
            "601888": "Consumer Cyclical",
            "601899": "Materials",
            "601988": "Financial Services",
            "601288": "Financial Services",
            "600031": "Materials",
            "600276": "Healthcare",
            "300033": "Technology",
            "300059": "Financial Services",
        }
        self.base_prices = {
            "AAPL": 180.0,
            "MSFT": 400.0,
            "GOOGL": 130.0,
            "AMZN": 170.0,
            "META": 300.0,
            "TSLA": 250.0,
            "JPM": 150.0,
            "V": 240.0,
            "JNJ": 160.0,
            "PFE": 40.0,
            "600519": 1700.0,
            "601318": 45.0,
            "000858": 160.0,
            "600036": 35.0,
            "601888": 180.0,
            "601899": 12.0,
            "601988": 3.8,
            "601288": 3.2,
            "600031": 18.0,
            "600276": 25.0,
            "300033": 298.10,
            "300059": 15.0,
        }
        self.quote_cache: dict[str, tuple[float, StockUpdate]] = {}
        self.history_cache: dict[str, tuple[float, StockHistoryResponse]] = {}
        self.market_hotspot_cache: dict[str, tuple[float, dict[str, Any]]] = {}
        self.quote_cache_ttl_seconds = 12.0
        self.history_cache_ttl_seconds = 120.0
        self.market_hotspot_cache_ttl_seconds = 5 * 60.0
        self.market_hotspot_stale_ttl_seconds = 4 * 60 * 60.0
        self.polygon_reference_cache_ttl_seconds = 24 * 60 * 60.0
        self.source_timeout_seconds = 6.0
        self.market_source_timeout_seconds = 20.0
        self.polygon_api_key = os.getenv("POLYGON_API_KEY", "").strip()
        self.cache_dir = Path(__file__).resolve().parents[2] / ".cache"
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.market_hotspot_cache_file = self.cache_dir / "market_hotspots.json"
        self.polygon_reference_cache_file = self.cache_dir / "polygon_us_common_stocks.json"
        self.http_headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0 Safari/537.36"
            )
        }

    def _normalize_metric_value(self, value: Any) -> float:
        if value is None:
            return 0.0
        if isinstance(value, str):
            cleaned = value.replace(",", "").replace("%", "").strip()
            if cleaned in {"", "--"}:
                return 0.0
            try:
                return float(cleaned)
            except ValueError:
                return 0.0
        try:
            return float(value)
        except (TypeError, ValueError):
            return 0.0

    def _safe_float(self, value: Any) -> float | None:
        try:
            number = float(value)
        except (TypeError, ValueError):
            return None

        if number != number:
            return None

        return number

    def _safe_int(self, value: Any) -> int | None:
        number = self._safe_float(value)
        if number is None:
            return None
        return int(number)

    def _build_stock_update(
        self,
        *,
        ticker: str,
        price: float,
        volume: int,
        previous_close: float | None,
        open_price: float | None = None,
        high_price: float | None = None,
        low_price: float | None = None,
        amount: float | None = None,
        turnover_rate: float | None = None,
    ) -> StockUpdate:
        rounded_price = round(price, 2)
        rounded_previous_close = round(previous_close, 2) if previous_close is not None else None
        change_value = (
            round(rounded_price - rounded_previous_close, 2)
            if rounded_previous_close is not None
            else None
        )
        change_percent = (
            round((change_value / rounded_previous_close) * 100, 2)
            if rounded_previous_close not in (None, 0) and change_value is not None
            else 0.0
        )
        rounded_high = round(high_price, 2) if high_price is not None else None
        rounded_low = round(low_price, 2) if low_price is not None else None
        amplitude_percent = (
            round(((rounded_high - rounded_low) / rounded_previous_close) * 100, 2)
            if rounded_previous_close not in (None, 0)
            and rounded_high is not None
            and rounded_low is not None
            else None
        )

        return StockUpdate(
            ticker=ticker,
            price=rounded_price,
            volume=max(volume, 0),
            change_percent=change_percent,
            change=change_value,
            open_price=round(open_price, 2) if open_price is not None else None,
            high_price=rounded_high,
            low_price=rounded_low,
            previous_close=rounded_previous_close,
            amount=round(amount, 2) if amount is not None else None,
            turnover_rate=round(turnover_rate, 2) if turnover_rate is not None else None,
            amplitude_percent=amplitude_percent,
        )

    def normalize_period(self, period: str) -> str:
        aliases = {
            "1w": "1wk",
            "1m": "1mo",
            "3m": "3mo",
            "12m": "1y",
        }
        return aliases.get(period, period)

    def get_stock_market(self, ticker: str) -> str:
        if ticker.isdigit() and len(ticker) == 6:
            return "CN"
        return "US"

    def get_period_spec(self, period: str) -> PeriodSpec:
        return PERIOD_SPECS.get(period, PERIOD_SPECS["1mo"])

    def normalize_interval(self, period: str, interval: str) -> str:
        allowed_by_period = {
            "1d": {"1m", "5m", "15m"},
            "1wk": {"15m", "30m", "1h"},
            "1mo": {"1d"},
            "3mo": {"1d"},
            "1y": {"1wk"},
        }
        spec = self.get_period_spec(period)
        if interval in allowed_by_period.get(period, set()):
            return interval
        return spec.default_interval

    def _find_column(self, columns: list[str], *keywords: str) -> str | None:
        lowered = [(column, column.lower()) for column in columns]
        for keyword in keywords:
            keyword_lower = keyword.lower()
            for original, lower_column in lowered:
                if keyword_lower in lower_column:
                    return original
        return None

    def _to_history_points(self, frame: Any) -> list[StockDataPoint]:
        if frame is None or getattr(frame, "empty", True):
            return []

        columns = [str(column) for column in frame.columns]
        time_column = self._find_column(columns, "datetime", "date", "鏃堕棿", "鏃ユ湡", "day")
        open_column = self._find_column(columns, "open", "开盘", "今开")
        high_column = self._find_column(columns, "high", "最高")
        low_column = self._find_column(columns, "low", "最低")
        close_column = self._find_column(columns, "close", "鏀剁洏", "鏈€鏂颁环")
        volume_column = self._find_column(columns, "volume", "成交量")

        if not all([time_column, open_column, high_column, low_column, close_column]):
            return []

        data: list[StockDataPoint] = []
        for _, row in frame.iterrows():
            try:
                timestamp = row[time_column]
                parsed_time = datetime.fromisoformat(str(timestamp).replace(" ", "T"))
                open_price = float(row[open_column])
                high_price = float(row[high_column])
                low_price = float(row[low_column])
                close_price = float(row[close_column])
                volume_value = int(float(row[volume_column])) if volume_column else 0
            except Exception:
                continue

            if not all(value == value for value in [open_price, high_price, low_price, close_price]):
                continue

            data.append(
                StockDataPoint(
                    timestamp=parsed_time.isoformat(),
                    open=round(open_price, 2),
                    high=round(high_price, 2),
                    low=round(low_price, 2),
                    close=round(close_price, 2),
                    volume=volume_value,
                )
            )

        data.sort(key=lambda item: item.timestamp)
        return data

    def _http_get_json(self, url: str) -> dict[str, Any]:
        request = urllib.request.Request(url, headers=self.http_headers)
        with urllib.request.urlopen(request, timeout=self.source_timeout_seconds) as response:
            return json.load(response)

    def _http_get_text(self, url: str) -> str:
        request = urllib.request.Request(url, headers=self.http_headers)
        with urllib.request.urlopen(request, timeout=self.source_timeout_seconds) as response:
            return response.read().decode("utf-8", errors="ignore")

    def _read_json_cache(self, path: Path) -> dict[str, Any] | None:
        try:
            if not path.exists():
                return None
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None

    def _write_json_cache(self, path: Path, payload: dict[str, Any]) -> None:
        try:
            path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        except OSError:
            return

    def _load_market_hotspot_cache(
        self, market: str, max_age_seconds: float
    ) -> dict[str, Any] | None:
        now = time.time()
        cached = self.market_hotspot_cache.get(market)
        if cached and now - cached[0] < max_age_seconds:
            return cached[1]

        payload = self._read_json_cache(self.market_hotspot_cache_file) or {}
        cached_market = payload.get(market)
        if not isinstance(cached_market, dict):
            return None

        saved_at = self._safe_float(cached_market.get("saved_at"))
        value = cached_market.get("value")
        if saved_at is None or not isinstance(value, dict):
            return None

        if now - saved_at >= max_age_seconds:
            return None

        self.market_hotspot_cache[market] = (saved_at, value)
        return value

    def _store_market_hotspot_cache(self, market: str, value: dict[str, Any]) -> None:
        now = time.time()
        self.market_hotspot_cache[market] = (now, value)
        payload = self._read_json_cache(self.market_hotspot_cache_file) or {}
        payload[market] = {"saved_at": now, "value": value}
        self._write_json_cache(self.market_hotspot_cache_file, payload)

    def _build_polygon_url(self, path: str, params: dict[str, Any] | None = None) -> str:
        if not self.polygon_api_key:
            raise ValueError("POLYGON_API_KEY is not configured")

        query = {"apiKey": self.polygon_api_key}
        if params:
            query.update({key: value for key, value in params.items() if value is not None})
        return f"https://api.polygon.io{path}?{urllib.parse.urlencode(query)}"

    def _append_polygon_api_key(self, url: str) -> str:
        if not self.polygon_api_key or "apiKey=" in url:
            return url
        joiner = "&" if "?" in url else "?"
        return f"{url}{joiner}apiKey={urllib.parse.quote(self.polygon_api_key)}"

    def _get_polygon_common_stock_type_codes(self) -> set[str]:
        payload = self._http_get_json(
            self._build_polygon_url(
                "/v3/reference/tickers/types",
                {"asset_class": "stocks", "locale": "us"},
            )
        )
        results = payload.get("results") or []
        allowed_codes: set[str] = set()
        for item in results:
            code = str(item.get("code") or "").strip()
            description = str(item.get("description") or "").lower()
            if not code:
                continue
            if "common stock" in description or "ordinary shares" in description:
                allowed_codes.add(code)

        if not allowed_codes:
            allowed_codes.add("CS")
        return allowed_codes

    def _get_polygon_common_stock_universe(self) -> dict[str, dict[str, str]]:
        cached = self._read_json_cache(self.polygon_reference_cache_file)
        now = time.time()
        if isinstance(cached, dict):
            saved_at = self._safe_float(cached.get("saved_at"))
            results = cached.get("results")
            if (
                saved_at is not None
                and now - saved_at < self.polygon_reference_cache_ttl_seconds
                and isinstance(results, dict)
            ):
                return {
                    str(ticker): {"name": str(meta.get("name") or ticker)}
                    for ticker, meta in results.items()
                    if isinstance(meta, dict)
                }

        allowed_codes = self._get_polygon_common_stock_type_codes()
        next_url = self._build_polygon_url(
            "/v3/reference/tickers",
            {"market": "stocks", "active": "true", "limit": 1000},
        )
        results: dict[str, dict[str, str]] = {}

        while next_url:
            payload = self._http_get_json(next_url)
            for item in payload.get("results") or []:
                ticker = str(item.get("ticker") or "").strip()
                type_code = str(item.get("type") or "").strip()
                if not ticker or type_code not in allowed_codes:
                    continue
                results[ticker] = {"name": str(item.get("name") or ticker)}

            next_url = payload.get("next_url")
            if next_url:
                next_url = self._append_polygon_api_key(str(next_url))

        if not results:
            raise ValueError("Polygon common stock universe returned no tickers")

        self._write_json_cache(
            self.polygon_reference_cache_file,
            {"saved_at": now, "results": results},
        )
        return results

    def _build_polygon_snapshot_row(
        self, snapshot: dict[str, Any], meta: dict[str, str]
    ) -> dict[str, Any] | None:
        ticker = str(snapshot.get("ticker") or "").strip()
        if not ticker:
            return None

        day_data = snapshot.get("day") or {}
        prev_day_data = snapshot.get("prevDay") or {}
        last_trade = snapshot.get("lastTrade") or {}
        price = (
            self._safe_float(last_trade.get("p"))
            or self._safe_float(day_data.get("c"))
            or self._safe_float(snapshot.get("todaysChange"))
        )
        previous_close = self._safe_float(prev_day_data.get("c"))
        if price is None or previous_close in (None, 0):
            return None

        change_value = self._safe_float(snapshot.get("todaysChange"))
        if change_value is None:
            change_value = price - previous_close

        change_percent = self._safe_float(snapshot.get("todaysChangePerc"))
        if change_percent is None:
            change_percent = (change_value / previous_close) * 100

        return {
            "ticker": ticker,
            "name": meta.get("name") or ticker,
            "price": round(price, 2),
            "change_percent": round(change_percent, 2),
            "change": round(change_value, 2),
            "volume": self._safe_int(day_data.get("v")) or 0,
            "amplitude_percent": None,
        }

    def _fetch_polygon_full_market_snapshot(self) -> list[dict[str, Any]]:
        payload = self._http_get_json(
            self._build_polygon_url("/v2/snapshot/locale/us/markets/stocks/tickers")
        )
        tickers = payload.get("tickers") or payload.get("results") or []
        if not tickers:
            raise ValueError("Polygon full market snapshot returned no tickers")
        return [ticker for ticker in tickers if isinstance(ticker, dict)]

    def _extract_yahoo_value(self, value: Any) -> float | int | None:
        if isinstance(value, dict):
            raw_value = value.get("raw")
            if raw_value is not None:
                return raw_value
        if isinstance(value, (int, float)):
            return value
        return None

    def _fetch_yahoo_screener_rows(self, screen_id: str, count: int = 5) -> list[dict[str, Any]]:
        params = urllib.parse.urlencode(
            {
                "formatted": "true",
                "scrIds": screen_id,
                "count": count,
            }
        )
        payload = self._http_get_json(
            f"https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?{params}"
        )
        finance = payload.get("finance", {})
        results = finance.get("result") or []
        if not results:
            return []

        quotes = results[0].get("quotes") or []
        rows: list[dict[str, Any]] = []
        for quote in quotes:
            ticker = str(quote.get("symbol") or "").strip()
            if not ticker:
                continue

            price = self._extract_yahoo_value(quote.get("regularMarketPrice"))
            change_percent = self._extract_yahoo_value(quote.get("regularMarketChangePercent"))
            change_value = self._extract_yahoo_value(quote.get("regularMarketChange"))
            volume = self._extract_yahoo_value(quote.get("regularMarketVolume")) or 0
            if price is None or change_percent is None:
                continue

            rows.append(
                {
                    "ticker": ticker,
                    "name": str(quote.get("shortName") or quote.get("longName") or ticker),
                    "price": round(float(price), 2),
                    "change_percent": round(float(change_percent), 2),
                    "change": round(float(change_value), 2) if change_value is not None else None,
                    "volume": int(float(volume)),
                    "amplitude_percent": None,
                }
            )

        return rows

    def _parse_us_chart_result(self, payload: dict[str, Any]) -> tuple[dict[str, Any], list[StockDataPoint]]:
        chart = payload.get("chart", {})
        error = chart.get("error")
        if error:
            raise ValueError(error.get("description", "US chart API returned an error"))

        results = chart.get("result") or []
        if not results:
            raise ValueError("US chart API returned no result")

        result = results[0]
        timestamps = result.get("timestamp") or []
        indicators = result.get("indicators", {}).get("quote") or []
        if not timestamps or not indicators:
            raise ValueError("US chart API returned empty series")

        quote = indicators[0]
        opens = quote.get("open") or []
        highs = quote.get("high") or []
        lows = quote.get("low") or []
        closes = quote.get("close") or []
        volumes = quote.get("volume") or []

        points: list[StockDataPoint] = []
        for index, timestamp in enumerate(timestamps):
            try:
                open_price = opens[index]
                high_price = highs[index]
                low_price = lows[index]
                close_price = closes[index]
            except IndexError:
                continue

            if any(value is None for value in (open_price, high_price, low_price, close_price)):
                continue

            volume_value = volumes[index] if index < len(volumes) and volumes[index] is not None else 0
            point_time = datetime.fromtimestamp(int(timestamp), tz=UTC)
            points.append(
                StockDataPoint(
                    timestamp=point_time.isoformat(),
                    open=round(float(open_price), 2),
                    high=round(float(high_price), 2),
                    low=round(float(low_price), 2),
                    close=round(float(close_price), 2),
                    volume=int(float(volume_value)),
                )
            )

        if not points:
            raise ValueError("US chart API points were empty after parsing")

        return result.get("meta", {}), points

    def _fetch_us_chart_history(self, ticker: str, range_value: str, interval: str) -> tuple[dict[str, Any], list[StockDataPoint]]:
        params = urllib.parse.urlencode(
            {
                "range": range_value,
                "interval": interval,
                "includePrePost": "false",
                "events": "div,splits",
            }
        )
        last_error: Exception | None = None
        for host in ("query1.finance.yahoo.com", "query2.finance.yahoo.com"):
            url = f"https://{host}/v8/finance/chart/{ticker}?{params}"
            for _ in range(2):
                try:
                    payload = self._http_get_json(url)
                    return self._parse_us_chart_result(payload)
                except Exception as exc:
                    last_error = exc
                    time.sleep(0.25)

        raise ValueError(f"US chart API failed for {ticker}: {last_error}")

    def _trim_points_for_period(self, points: list[StockDataPoint], period: str) -> list[StockDataPoint]:
        spec = self.get_period_spec(period)
        if period in {"1d", "1wk"}:
            return points[-spec.fallback_points :]
        if period == "1mo":
            return points[-22:]
        if period == "3mo":
            return points[-66:]
        if period == "1y":
            return points[-52:]
        return points

    def _filter_points_to_latest_session(
        self, points: list[StockDataPoint], market: str
    ) -> list[StockDataPoint]:
        if not points:
            return []

        timezone = ZoneInfo("America/New_York") if market == "US" else ZoneInfo("Asia/Shanghai")
        parsed_points: list[tuple[datetime, StockDataPoint]] = []
        latest_session_date = None

        for point in points:
            try:
                parsed_time = datetime.fromisoformat(point.timestamp)
            except ValueError:
                continue

            localized_time = parsed_time.astimezone(timezone)
            parsed_points.append((localized_time, point))
            if latest_session_date is None or localized_time.date() > latest_session_date:
                latest_session_date = localized_time.date()

        if latest_session_date is None:
            return []

        return [
            point
            for localized_time, point in parsed_points
            if localized_time.date() == latest_session_date
        ]

    def _sanitize_history_points(self, points: list[StockDataPoint]) -> list[StockDataPoint]:
        sanitized: list[StockDataPoint] = []
        seen_timestamps: set[str] = set()

        for point in sorted(points, key=lambda item: item.timestamp):
            if point.timestamp in seen_timestamps:
                continue

            high_value = max(point.high, point.open, point.close, point.low)
            low_value = min(point.low, point.open, point.close, point.high)
            sanitized.append(
                StockDataPoint(
                    timestamp=point.timestamp,
                    open=round(point.open, 2),
                    high=round(high_value, 2),
                    low=round(low_value, 2),
                    close=round(point.close, 2),
                    volume=max(int(point.volume), 0),
                )
            )
            seen_timestamps.add(point.timestamp)

        return sanitized

    def _fetch_us_history(self, ticker: str, period: str, interval: str) -> list[StockDataPoint]:
        spec = self.get_period_spec(period)
        _, points = self._fetch_us_chart_history(ticker, spec.yfinance_period, interval)
        return self._trim_points_for_period(points, period)

    def _fetch_cn_daily_history(self, ticker: str, period: str) -> list[StockDataPoint]:
        spec = self.get_period_spec(period)
        end_date = datetime.now()
        start_date = end_date - timedelta(days=spec.history_window_days)
        frame = ak.stock_zh_a_hist(
            symbol=ticker,
            period="daily",
            start_date=start_date.strftime("%Y%m%d"),
            end_date=end_date.strftime("%Y%m%d"),
            adjust="qfq",
        )
        data = self._to_history_points(frame)
        if period == "1mo":
            return data[-22:]
        if period == "3mo":
            return data[-66:]
        if period == "1y":
            return data[-52:]
        return data

    def _fetch_cn_intraday_history(self, ticker: str, period: str, interval: str) -> list[StockDataPoint]:
        spec = self.get_period_spec(period)
        period_value = interval.replace("m", "")
        if interval == "1h":
            period_value = "60"
        end_date = datetime.now()
        start_date = end_date - timedelta(days=spec.history_window_days)
        frame = ak.stock_zh_a_hist_min_em(
            symbol=ticker,
            period=period_value,
            adjust="qfq",
            start_date=start_date.strftime("%Y-%m-%d %H:%M:%S"),
            end_date=end_date.strftime("%Y-%m-%d %H:%M:%S"),
        )
        data = self._to_history_points(frame)
        return data[-spec.fallback_points :]

    def _generate_fallback_history(self, ticker: str, period: str) -> list[StockDataPoint]:
        spec = self.get_period_spec(period)
        target_close = self.base_prices.get(ticker, random.uniform(20, 300))
        current_close = target_close
        step = timedelta(minutes=spec.fallback_step_minutes)
        start_time = datetime.now() - step * (spec.fallback_points - 1)
        data: list[StockDataPoint] = []

        for index in range(spec.fallback_points):
            open_price = current_close
            drift = random.uniform(-2.0, 2.0)
            close_price = max(0.01, open_price + drift)
            high_price = max(open_price, close_price) + random.uniform(0, abs(drift) + 1.2)
            low_price = min(open_price, close_price) - random.uniform(0, abs(drift) + 1.2)
            timestamp = start_time + index * step
            volume = random.randint(500_000, 12_000_000)

            data.append(
                StockDataPoint(
                    timestamp=timestamp.isoformat(),
                    open=round(open_price, 2),
                    high=round(high_price, 2),
                    low=round(max(0.01, low_price), 2),
                    close=round(close_price, 2),
                    volume=volume,
                )
            )
            current_close = close_price

        close_shift = round(target_close - data[-1].close, 2)
        if close_shift != 0:
            adjusted: list[StockDataPoint] = []
            for point in data:
                adjusted.append(
                    StockDataPoint(
                        timestamp=point.timestamp,
                        open=round(point.open + close_shift, 2),
                        high=round(point.high + close_shift, 2),
                        low=round(max(0.01, point.low + close_shift), 2),
                        close=round(point.close + close_shift, 2),
                        volume=point.volume,
                    )
                )
            data = adjusted

        self.base_prices[ticker] = target_close
        return data

    async def _run_with_timeout(
        self, func: Any, *args: Any, timeout: float | None = None
    ) -> Any:
        return await asyncio.wait_for(
            asyncio.to_thread(func, *args),
            timeout=timeout or self.source_timeout_seconds,
        )

    async def get_historical_data(
        self, ticker: str, period: str = "1mo", interval: str = "1d"
    ) -> StockHistoryResponse:
        period = self.normalize_period(period)
        interval = self.normalize_interval(period, interval)
        market = self.get_stock_market(ticker)
        cache_key = f"{ticker}:{period}:{interval}"
        now = time.time()
        cached_history = self.history_cache.get(cache_key)
        if cached_history and now - cached_history[0] < self.history_cache_ttl_seconds:
          return cached_history[1]

        try:
            if market == "US":
                data = await self._run_with_timeout(self._fetch_us_history, ticker, period, interval)
            elif period in {"1d", "1wk"}:
                data = await self._run_with_timeout(self._fetch_cn_intraday_history, ticker, period, interval)
            else:
                data = await self._run_with_timeout(self._fetch_cn_daily_history, ticker, period)
        except Exception as exc:
            print(f"Error fetching {market} historical data for {ticker}: {exc}")
            data = []

        if not data:
            data = self._generate_fallback_history(ticker, period)

        if period == "1d":
            latest_session_data = self._filter_points_to_latest_session(data, market)
            if latest_session_data:
                data = latest_session_data

        data = self._sanitize_history_points(data)
        latest_close = data[-1].close
        self.base_prices[ticker] = latest_close
        response = StockHistoryResponse(ticker=ticker, data=data)
        self.history_cache[cache_key] = (now, response)
        return response

    def _fetch_us_quote(self, ticker: str) -> StockUpdate:
        meta, daily_points = self._fetch_us_chart_history(ticker, "5d", "1d")

        if not daily_points:
            raise ValueError(f"No US quote data returned for {ticker}")

        latest = daily_points[-1]
        # Yahoo's chartPreviousClose can represent the close before the whole range,
        # not necessarily the immediately previous trading day's close.
        previous_close = (
            daily_points[-2].close
            if len(daily_points) > 1
            else self._safe_float(meta.get("chartPreviousClose")) or latest.close
        )

        return self._build_stock_update(
            ticker=ticker,
            price=self._safe_float(meta.get("regularMarketPrice")) or latest.close,
            volume=self._safe_int(meta.get("regularMarketVolume")) or latest.volume,
            previous_close=previous_close,
            open_price=self._safe_float(meta.get("regularMarketOpen")) or latest.open,
            high_price=self._safe_float(meta.get("regularMarketDayHigh")) or latest.high,
            low_price=self._safe_float(meta.get("regularMarketDayLow")) or latest.low,
        )

    def _fetch_cn_quote(self, ticker: str) -> StockUpdate:
        frame = ak.stock_zh_a_spot_em()
        if frame is None or getattr(frame, "empty", True):
            raise ValueError("CN quote frame is empty")

        code_column = self._find_column([str(column) for column in frame.columns], "浠ｇ爜", "symbol", "ticker")
        if not code_column:
            raise ValueError("CN quote code column not found")

        matched = frame[frame[code_column].astype(str) == ticker]
        if matched.empty:
            raise ValueError(f"CN quote not found for {ticker}")

        row = matched.iloc[0]
        columns = [str(column) for column in matched.columns]
        price_column = self._find_column(columns, "鏈€鏂颁环", "close", "price")
        previous_close_column = self._find_column(columns, "鏄ㄦ敹", "previous", "preclose")
        volume_column = self._find_column(columns, "成交量", "volume")

        if not all([price_column, previous_close_column, volume_column]):
            raise ValueError("CN quote columns missing")

        current_price = float(row[price_column])
        previous_close = float(row[previous_close_column])
        volume = int(float(row[volume_column]))
        change_percent = 0.0 if previous_close == 0 else ((current_price - previous_close) / previous_close) * 100
        return StockUpdate(
            ticker=ticker,
            price=round(current_price, 2),
            volume=volume,
            change_percent=round(change_percent, 2),
        )

    async def get_real_time_data(self, ticker: str) -> StockUpdate:
        cached = self.quote_cache.get(ticker)
        now = time.time()
        if cached and now - cached[0] < self.quote_cache_ttl_seconds:
            return cached[1]

        market = self.get_stock_market(ticker)
        try:
            if market == "US":
                update = await self._run_with_timeout(self._fetch_us_quote, ticker)
            else:
                update = await self._run_with_timeout(self._fetch_cn_quote, ticker)
        except Exception as exc:
            print(f"Error fetching quote for {ticker}: {exc}")
            day_history = await self.get_historical_data(ticker, "1d", "5m")
            latest = day_history.data[-1]
            daily_history = await self.get_historical_data(ticker, "1mo", "1d")
            previous_close = (
                daily_history.data[-2].close
                if len(daily_history.data) > 1
                else latest.close
            )
            day_high = max(point.high for point in day_history.data)
            day_low = min(point.low for point in day_history.data)
            day_open = day_history.data[0].open if day_history.data else latest.open
            update = self._build_stock_update(
                ticker=ticker,
                price=latest.close,
                volume=latest.volume,
                previous_close=previous_close,
                open_price=day_open,
                high_price=day_high,
                low_price=day_low,
            )

        self.base_prices[ticker] = update.price
        self.quote_cache[ticker] = (now, update)
        return update

    async def get_recommendations(self, ticker: str) -> list[str]:
        industry = self.industry_map.get(ticker, "Technology")
        recommendations = [
            symbol
            for symbol, symbol_industry in self.industry_map.items()
            if symbol_industry == industry and symbol != ticker
        ]
        return recommendations[:5]

    async def search_stocks(self, query: str, market: str) -> list[dict[str, str]]:
        results: list[dict[str, str]] = []
        if market == "US":
            us_stocks = [
                {"ticker": "AAPL", "name": "Apple Inc."},
                {"ticker": "MSFT", "name": "Microsoft Corporation"},
                {"ticker": "GOOGL", "name": "Alphabet Inc."},
                {"ticker": "AMZN", "name": "Amazon.com Inc."},
                {"ticker": "META", "name": "Meta Platforms Inc."},
                {"ticker": "TSLA", "name": "Tesla Inc."},
                {"ticker": "JPM", "name": "JPMorgan Chase & Co."},
                {"ticker": "V", "name": "Visa Inc."},
                {"ticker": "JNJ", "name": "Johnson & Johnson"},
                {"ticker": "PFE", "name": "Pfizer Inc."},
                {"ticker": "NVDA", "name": "NVIDIA Corporation"},
                {"ticker": "NFLX", "name": "Netflix Inc."},
                {"ticker": "BABA", "name": "Alibaba Group Holding Limited"},
                {"ticker": "TSM", "name": "Taiwan Semiconductor Manufacturing Company Limited"},
                {"ticker": "VOO", "name": "Vanguard S&P 500 ETF"},
                {"ticker": "QQQ", "name": "Invesco QQQ Trust"},
                {"ticker": "SPY", "name": "SPDR S&P 500 ETF Trust"},
                {"ticker": "PLTR", "name": "Palantir Technologies Inc."},
            ]
            return [
                stock
                for stock in us_stocks
                if query.lower() in stock["ticker"].lower() or query.lower() in stock["name"].lower()
            ]

        try:
            frame = await self._run_with_timeout(ak.stock_zh_a_spot_em)
            if frame is None or getattr(frame, "empty", True):
                raise ValueError("CN stock list is empty")
            columns = [str(column) for column in frame.columns]
            code_column = self._find_column(columns, "浠ｇ爜", "symbol", "ticker")
            name_column = self._find_column(columns, "鍚嶇О", "name")
            if not code_column or not name_column:
                raise ValueError("CN stock list columns missing")
            filtered = frame[
                frame[code_column].astype(str).str.contains(query, case=False, na=False)
                | frame[name_column].astype(str).str.contains(query, case=False, na=False)
            ]
            for _, row in filtered.head(20).iterrows():
                results.append(
                    {
                        "ticker": str(row[code_column]),
                        "name": str(row[name_column]),
                    }
                )
            return results
        except Exception as exc:
            print(f"Error searching CN stocks: {exc}")
            cn_stocks = [
                {"ticker": "600519", "name": "Kweichow Moutai"},
                {"ticker": "601318", "name": "Ping An"},
                {"ticker": "000858", "name": "Wuliangye"},
                {"ticker": "600036", "name": "China Merchants Bank"},
                {"ticker": "601888", "name": "China Tourism Group"},
                {"ticker": "601899", "name": "Zijin Mining"},
                {"ticker": "601988", "name": "Bank of China"},
                {"ticker": "601288", "name": "Agricultural Bank of China"},
                {"ticker": "600031", "name": "Sany Heavy Industry"},
                {"ticker": "600276", "name": "Hengrui Medicine"},
                {"ticker": "300033", "name": "Tonghuashun"},
                {"ticker": "300059", "name": "East Money"},
            ]
            return [
                stock
                for stock in cn_stocks
                if query.lower() in stock["ticker"].lower() or query.lower() in stock["name"].lower()
            ]

    async def get_market_hotspots(self, market: str) -> dict[str, Any]:
        normalized_market = market.upper()
        universe = self.market_hotspot_universe.get(
            normalized_market, self.market_hotspot_universe["US"]
        )
        quotes = await asyncio.gather(
            *(self.get_real_time_data(item["ticker"]) for item in universe),
            return_exceptions=True,
        )

        rows: list[dict[str, Any]] = []
        for item, quote in zip(universe, quotes):
            if isinstance(quote, Exception):
                continue

            rows.append(
                {
                    "ticker": item["ticker"],
                    "name": item["name"],
                    "price": quote.price,
                    "change_percent": quote.change_percent,
                    "change": quote.change,
                    "volume": quote.volume,
                    "amplitude_percent": quote.amplitude_percent,
                }
            )

        if not rows:
            raise ValueError(f"No hotspot rows available for market {normalized_market}")

        if normalized_market == "US":
            index_tickers = set(self.market_hotspot_indices.get(normalized_market, []))
            indices = [row for row in rows if row["ticker"] in index_tickers]
            sectors = [
                {**row, "sector": self.us_sector_map.get(row["ticker"], row["name"])}
                for row in rows
                if row["ticker"] in self.us_sector_map
            ]
            volatility = next((row for row in rows if row["ticker"] == "^VIX"), None)
            leaders = sorted(sectors, key=lambda row: row["change_percent"], reverse=True)[:5]
            laggards = sorted(sectors, key=lambda row: row["change_percent"])[:5]
            active = sorted(sectors, key=lambda row: row["volume"], reverse=True)[:5]
            advancers = sum(1 for row in sectors if row["change_percent"] > 0)
            decliners = sum(1 for row in sectors if row["change_percent"] < 0)
            flat = max(len(sectors) - advancers - decliners, 0)

            return {
                "market": normalized_market,
                "indices": indices,
                "sectors": sectors,
                "leaders": leaders,
                "laggards": laggards,
                "active": active,
                "breadth": {
                    "advancers": advancers,
                    "decliners": decliners,
                    "flat": flat,
                    "total": len(sectors),
                },
                "summary": {
                    "market": normalized_market,
                    "mode": "us_market_overview",
                    "breadth_ratio": round((advancers / max(len(sectors), 1)) * 100, 2),
                    "proxy_count": len(sectors),
                    "vix": volatility["price"] if volatility else None,
                    "vix_change": volatility["change_percent"] if volatility else None,
                },
                "updated_at": datetime.now(UTC).isoformat(),
            }

        index_tickers = set(self.market_hotspot_indices.get(normalized_market, []))
        indices = [row for row in rows if row["ticker"] in index_tickers]
        movers = [row for row in rows if row["ticker"] not in index_tickers]

        leaders = sorted(movers, key=lambda row: row["change_percent"], reverse=True)[:5]
        laggards = sorted(movers, key=lambda row: row["change_percent"])[:5]
        active = sorted(movers, key=lambda row: row["volume"], reverse=True)[:5]

        advancers = sum(1 for row in movers if row["change_percent"] > 0)
        decliners = sum(1 for row in movers if row["change_percent"] < 0)
        flat = max(len(movers) - advancers - decliners, 0)

        summary = {
            "market": normalized_market,
            "mode": "proxy",
            "breadth_ratio": round((advancers / max(len(movers), 1)) * 100, 2),
        }

        if normalized_market == "CN":
            try:
                activity = await self._run_with_timeout(ak.stock_market_activity_legu)
                activity_map = {
                    str(row["item"]): self._normalize_metric_value(row["value"])
                    for _, row in activity.iterrows()
                }
                fund_flow = await self._run_with_timeout(ak.stock_market_fund_flow)
                latest_flow = fund_flow.iloc[-1].to_dict() if not fund_flow.empty else {}
                summary = {
                    "market": normalized_market,
                    "mode": "full_market",
                    "up": int(activity_map.get("涓婃定", advancers)),
                    "down": int(activity_map.get("涓嬭穼", decliners)),
                    "flat": int(activity_map.get("骞崇洏", flat)),
                    "limit_up": int(activity_map.get("娑ㄥ仠", 0)),
                    "limit_down": int(activity_map.get("璺屽仠", 0)),
                    "new_high": int(activity_map.get("创新高", 0)),
                    "new_low": int(activity_map.get("创新低", 0)),
                    "main_flow_net": self._normalize_metric_value(latest_flow.get("主力净流入-净额")),
                    "sh_change": self._normalize_metric_value(latest_flow.get("上证-涨跌幅")),
                    "sz_change": self._normalize_metric_value(latest_flow.get("深证-涨跌幅")),
                    "breadth_ratio": round(
                        (
                            int(activity_map.get("涓婃定", advancers))
                            / max(
                                int(activity_map.get("涓婃定", advancers))
                                + int(activity_map.get("涓嬭穼", decliners))
                                + int(activity_map.get("骞崇洏", flat)),
                                1,
                            )
                        )
                        * 100,
                        2,
                    ),
                }
            except Exception as exc:
                print(f"Error fetching CN full-market summary: {exc}")
        else:
            summary = {
                "market": normalized_market,
                "mode": "broad_market_proxy",
                "breadth_ratio": round((advancers / max(len(movers), 1)) * 100, 2),
                "proxy_count": len(rows),
            }

        return {
            "market": normalized_market,
            "indices": indices,
            "leaders": leaders,
            "laggards": laggards,
            "active": active,
            "breadth": {
                "advancers": advancers,
                "decliners": decliners,
                "flat": flat,
                "total": len(movers),
            },
            "summary": summary,
            "updated_at": datetime.now(UTC).isoformat(),
        }

    async def _get_hotspot_proxy_rows(self, market: str) -> list[dict[str, Any]]:
        universe = self.market_hotspot_universe.get(market, self.market_hotspot_universe["US"])
        quotes = await asyncio.gather(
            *(self.get_real_time_data(item["ticker"]) for item in universe),
            return_exceptions=True,
        )

        rows: list[dict[str, Any]] = []
        for item, quote in zip(universe, quotes):
            if isinstance(quote, Exception):
                continue

            rows.append(
                {
                    "ticker": item["ticker"],
                    "name": item["name"],
                    "price": quote.price,
                    "change_percent": quote.change_percent,
                    "change": quote.change,
                    "volume": quote.volume,
                    "amplitude_percent": quote.amplitude_percent,
                }
            )

        return rows

    async def _build_proxy_market_hotspots(self, market: str) -> dict[str, Any]:
        rows = await self._get_hotspot_proxy_rows(market)
        if not rows:
            raise ValueError(f"No hotspot rows available for market {market}")

        if market == "US":
            index_tickers = set(self.market_hotspot_indices.get(market, []))
            indices = [row for row in rows if row["ticker"] in index_tickers]
            sectors = [
                {**row, "sector": self.us_sector_map.get(row["ticker"], row["name"])}
                for row in rows
                if row["ticker"] in self.us_sector_map
            ]
            volatility = next((row for row in rows if row["ticker"] == "^VIX"), None)
            leaders = self._fetch_yahoo_screener_rows("day_gainers", 5)
            laggards = self._fetch_yahoo_screener_rows("day_losers", 5)
            active = self._fetch_yahoo_screener_rows("most_actives", 5)
            advancers = sum(1 for row in sectors if row["change_percent"] > 0)
            decliners = sum(1 for row in sectors if row["change_percent"] < 0)
            flat = max(len(sectors) - advancers - decliners, 0)

            return {
                "market": market,
                "indices": indices,
                "sectors": sectors,
                "leaders": leaders,
                "laggards": laggards,
                "active": active,
                "breadth": {
                    "advancers": advancers,
                    "decliners": decliners,
                    "flat": flat,
                    "total": len(sectors),
                },
                "summary": {
                    "market": market,
                    "mode": "us_market_overview",
                    "breadth_ratio": round((advancers / max(len(sectors), 1)) * 100, 2),
                    "proxy_count": len(sectors),
                    "vix": volatility["price"] if volatility else None,
                    "vix_change": volatility["change_percent"] if volatility else None,
                },
                "updated_at": datetime.now(UTC).isoformat(),
            }

        index_tickers = set(self.market_hotspot_indices.get(market, []))
        indices = [row for row in rows if row["ticker"] in index_tickers]
        movers = [row for row in rows if row["ticker"] not in index_tickers]
        leaders = sorted(movers, key=lambda row: row["change_percent"], reverse=True)[:5]
        laggards = sorted(movers, key=lambda row: row["change_percent"])[:5]
        active = sorted(movers, key=lambda row: row["volume"], reverse=True)[:5]
        advancers = sum(1 for row in movers if row["change_percent"] > 0)
        decliners = sum(1 for row in movers if row["change_percent"] < 0)
        flat = max(len(movers) - advancers - decliners, 0)
        summary = {
            "market": market,
            "mode": "proxy",
            "breadth_ratio": round((advancers / max(len(movers), 1)) * 100, 2),
        }

        if market != "CN":
            summary = {
                "market": market,
                "mode": "broad_market_proxy",
                "breadth_ratio": round((advancers / max(len(movers), 1)) * 100, 2),
                "proxy_count": len(rows),
            }

        return {
            "market": market,
            "indices": indices,
            "leaders": leaders,
            "laggards": laggards,
            "active": active,
            "breadth": {
                "advancers": advancers,
                "decliners": decliners,
                "flat": flat,
                "total": len(movers),
            },
            "summary": summary,
            "updated_at": datetime.now(UTC).isoformat(),
        }

    def _build_us_full_market_hotspots(self, proxy_rows: list[dict[str, Any]]) -> dict[str, Any]:
        common_stock_universe = self._get_polygon_common_stock_universe()
        snapshots = self._fetch_polygon_full_market_snapshot()
        full_market_rows: list[dict[str, Any]] = []

        for snapshot in snapshots:
            ticker = str(snapshot.get("ticker") or "").strip()
            meta = common_stock_universe.get(ticker)
            if not meta:
                continue

            row = self._build_polygon_snapshot_row(snapshot, meta)
            if row is None:
                continue

            full_market_rows.append(row)

        if not full_market_rows:
            raise ValueError("Polygon full market snapshot contained no eligible common stocks")

        index_tickers = set(self.market_hotspot_indices.get("US", []))
        indices = [row for row in proxy_rows if row["ticker"] in index_tickers]
        sectors = [
            {**row, "sector": self.us_sector_map.get(row["ticker"], row["name"])}
            for row in proxy_rows
            if row["ticker"] in self.us_sector_map
        ]
        volatility = next((row for row in proxy_rows if row["ticker"] == "^VIX"), None)
        leaders = sorted(
            full_market_rows,
            key=lambda row: (row["change_percent"], row["volume"]),
            reverse=True,
        )[:5]
        laggards = sorted(
            full_market_rows,
            key=lambda row: (row["change_percent"], -row["volume"]),
        )[:5]
        active = sorted(
            full_market_rows,
            key=lambda row: (row["volume"], abs(row["change_percent"])),
            reverse=True,
        )[:5]
        advancers = sum(1 for row in full_market_rows if row["change_percent"] > 0)
        decliners = sum(1 for row in full_market_rows if row["change_percent"] < 0)
        flat = max(len(full_market_rows) - advancers - decliners, 0)

        return {
            "market": "US",
            "indices": indices,
            "sectors": sectors,
            "leaders": leaders,
            "laggards": laggards,
            "active": active,
            "breadth": {
                "advancers": advancers,
                "decliners": decliners,
                "flat": flat,
                "total": len(full_market_rows),
            },
            "summary": {
                "market": "US",
                "mode": "full_market",
                "breadth_ratio": round((advancers / max(len(full_market_rows), 1)) * 100, 2),
                "proxy_count": len(sectors),
                "vix": volatility["price"] if volatility else None,
                "vix_change": volatility["change_percent"] if volatility else None,
                "universe_count": len(common_stock_universe),
            },
            "updated_at": datetime.now(UTC).isoformat(),
        }

    async def get_market_hotspots(self, market: str) -> dict[str, Any]:
        normalized_market = market.upper()
        cached_response = self._load_market_hotspot_cache(
            normalized_market, self.market_hotspot_cache_ttl_seconds
        )
        has_polygon_full_market = normalized_market == "US" and bool(self.polygon_api_key)
        if cached_response is not None and (
            not has_polygon_full_market
            or cached_response.get("summary", {}).get("mode") == "full_market"
        ):
            return cached_response

        stale_response = self._load_market_hotspot_cache(
            normalized_market, self.market_hotspot_stale_ttl_seconds
        )

        try:
            if normalized_market == "US" and self.polygon_api_key:
                proxy_rows = await self._get_hotspot_proxy_rows(normalized_market)
                response = await self._run_with_timeout(
                    self._build_us_full_market_hotspots,
                    proxy_rows,
                    timeout=self.market_source_timeout_seconds,
                )
            else:
                response = await self._build_proxy_market_hotspots(normalized_market)
        except Exception as exc:
            print(f"Error fetching market hotspots for {normalized_market}: {exc}")
            if stale_response is not None and (
                not has_polygon_full_market
                or stale_response.get("summary", {}).get("mode") == "full_market"
            ):
                return stale_response
            if normalized_market == "US":
                response = await self._build_proxy_market_hotspots(normalized_market)
            else:
                raise

        self._store_market_hotspot_cache(normalized_market, response)
        return response

