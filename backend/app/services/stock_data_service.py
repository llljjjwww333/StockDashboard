from __future__ import annotations

import asyncio
import json
import random
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

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
        self.quote_cache_ttl_seconds = 12.0
        self.history_cache_ttl_seconds = 120.0
        self.source_timeout_seconds = 6.0
        self.http_headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0 Safari/537.36"
            )
        }

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
        time_column = self._find_column(columns, "datetime", "date", "时间", "日期", "day")
        open_column = self._find_column(columns, "open", "开盘", "今开")
        high_column = self._find_column(columns, "high", "最高")
        low_column = self._find_column(columns, "low", "最低")
        close_column = self._find_column(columns, "close", "收盘", "最新价")
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

    async def _run_with_timeout(self, func: Any, *args: Any) -> Any:
        return await asyncio.wait_for(
            asyncio.to_thread(func, *args),
            timeout=self.source_timeout_seconds,
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
        previous_close = self._safe_float(meta.get("chartPreviousClose"))
        if previous_close is None:
            previous_close = daily_points[-2].close if len(daily_points) > 1 else latest.close

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

        code_column = self._find_column([str(column) for column in frame.columns], "代码", "symbol", "ticker")
        if not code_column:
            raise ValueError("CN quote code column not found")

        matched = frame[frame[code_column].astype(str) == ticker]
        if matched.empty:
            raise ValueError(f"CN quote not found for {ticker}")

        row = matched.iloc[0]
        columns = [str(column) for column in matched.columns]
        price_column = self._find_column(columns, "最新价", "close", "price")
        previous_close_column = self._find_column(columns, "昨收", "previous", "preclose")
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
            history = await self.get_historical_data(ticker, "1mo", "1d")
            latest = history.data[-1]
            previous_close = history.data[-2].close if len(history.data) > 1 else latest.close
            change_percent = 0.0 if previous_close == 0 else ((latest.close - previous_close) / previous_close) * 100
            update = StockUpdate(
                ticker=ticker,
                price=round(latest.close, 2),
                volume=latest.volume,
                change_percent=round(change_percent, 2),
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
            code_column = self._find_column(columns, "代码", "symbol", "ticker")
            name_column = self._find_column(columns, "名称", "name")
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
