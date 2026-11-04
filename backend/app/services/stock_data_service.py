from __future__ import annotations

import asyncio
import json
import os
import re
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from app.services.cn_market import CN_INDICES, ChinaBoardFeed
from datetime import UTC, datetime, timedelta
from pathlib import Path
from math import isfinite
from calendar import monthrange
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any
from zoneinfo import ZoneInfo

import akshare as ak

from app.schemas.stock import (
    AiContextAnalysisRequest,
    AiContextAnalysisResponse,
    AiProviderSettings,
    FinanceNewsAiRequest,
    FinanceNewsAiResponse,
    FinanceNewsItem,
    FinanceNewsResponse,
    OrderBook,
    StockDataPoint,
    StockHistoryResponse,
    StockUpdate,
)


@dataclass(frozen=True)
class PeriodSpec:
    history_window_days: int
    default_interval: str
    fallback_points: int
    fallback_step_minutes: int
    yfinance_period: str


PERIOD_SPECS: dict[str, PeriodSpec] = {
    "1d": PeriodSpec(2, "1m", 391, 1, "5d"),
    "5d": PeriodSpec(10, "1m", 1955, 1, "5d"),
    "1mo": PeriodSpec(45, "1d", 30, 24 * 60, "3mo"),
    "3mo": PeriodSpec(120, "1d", 90, 24 * 60, "6mo"),
    "1y": PeriodSpec(400, "1d", 250, 24 * 60, "2y"),
}

CN_TIMEZONE = ZoneInfo("Asia/Shanghai")
US_TIMEZONE = ZoneInfo("America/New_York")


class DataSourceUnavailable(RuntimeError):
    """No verified market data is currently available."""


class StockDataService:
    def __init__(self) -> None:
        self.cn_boards = ChinaBoardFeed(self._http_get_json)
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
        self.cn_sector_map = {
            "510050": "上证50",
            "510300": "沪深300",
            "510500": "中证500",
            "159915": "创业板",
            "588000": "科创50",
            "512480": "半导体",
            "512170": "医疗",
            "512010": "医药",
            "512880": "券商",
            "515030": "新能源车",
            "159928": "消费",
            "516160": "新能源",
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
                {"ticker": "510050", "name": "上证50ETF"},
                {"ticker": "510300", "name": "沪深300ETF"},
                {"ticker": "510500", "name": "中证500ETF"},
                {"ticker": "159915", "name": "创业板ETF"},
                {"ticker": "588000", "name": "科创50ETF"},
                {"ticker": "512480", "name": "半导体ETF"},
                {"ticker": "512170", "name": "医疗ETF"},
                {"ticker": "512010", "name": "医药ETF"},
                {"ticker": "512880", "name": "证券ETF"},
                {"ticker": "515030", "name": "新能源车ETF"},
                {"ticker": "159928", "name": "消费ETF"},
                {"ticker": "516160", "name": "新能源ETF"},
            ],
        }
        self.market_hotspot_indices = {
            "US": ["SPY", "QQQ", "DIA", "IWM"],
            "CN": ["510050", "510300", "510500", "159915", "588000"],
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
        self.quote_cache: dict[str, tuple[float, StockUpdate]] = {}
        self.history_cache: dict[str, tuple[float, StockHistoryResponse]] = {}
        self.history_locks: dict[str, asyncio.Lock] = {}
        self.history_refresh_tasks: dict[str, asyncio.Task] = {}
        self.history_retry_after: dict[str, float] = {}
        self.market_hotspot_cache: dict[str, tuple[float, dict[str, Any]]] = {}
        self.news_cache: dict[str, tuple[float, FinanceNewsResponse]] = {}
        self.quote_cache_ttl_seconds = 2.0
        self.quote_stale_ttl_seconds = 60 * 60.0
        self.quote_refresh_lock = asyncio.Lock()
        self.us_symbol_map: dict[str, str] = {}
        self.search_cache: dict[str, tuple[float, list[dict[str, str]]]] = {}
        self.history_cache_ttl_seconds = 120.0
        self.market_hotspot_cache_ttl_seconds = 5 * 60.0
        self.news_cache_ttl_seconds = 90.0
        self.market_hotspot_stale_ttl_seconds = 4 * 60 * 60.0
        self.polygon_reference_cache_ttl_seconds = 24 * 60 * 60.0
        self.cn_full_market_universe_cache_ttl_seconds = 24 * 60 * 60.0
        self.source_timeout_seconds = 6.0
        self.market_source_timeout_seconds = 20.0
        self.polygon_api_key = os.getenv("POLYGON_API_KEY", "").strip()
        self.cache_dir = Path(__file__).resolve().parents[2] / ".cache"
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.market_hotspot_cache_file = self.cache_dir / "market_hotspots_verified.json"
        self.hotspot_tasks: dict[str, asyncio.Task] = {}
        self.hotspot_attempts: dict[str, float] = {}
        self.polygon_reference_cache_file = self.cache_dir / "polygon_us_common_stocks.json"
        self.cn_a_share_universe_cache_file = self.cache_dir / "cn_a_share_universe.json"
        self.http_headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0 Safari/537.36"
            )
        }
        self.news_keyword_stopwords = {
            "市场", "财经", "公司", "今日", "全球", "中国", "美国", "数据", "显示",
            "表示", "相关", "今年", "行业", "概念", "板块", "经济", "消息", "集团",
            "Finance", "Global", "Market", "Stocks", "Stock", "Today", "News",
        }

    def _normalize_openai_compatible_url(self, base_url: str) -> str:
        normalized = base_url.strip().rstrip("/")
        if normalized.endswith("/chat/completions"):
            return normalized
        if normalized.endswith("/v1"):
            return f"{normalized}/chat/completions"
        return f"{normalized}/v1/chat/completions"

    def _request_openai_compatible_json(
        self,
        settings: AiProviderSettings,
        language: str,
        news_items: list[FinanceNewsItem],
    ) -> dict[str, Any]:
        endpoint = self._normalize_openai_compatible_url(settings.base_url)
        normalized_language = language.lower()
        wants_chinese = normalized_language.startswith("zh")
        compact_news = [
            {
                "title": item.title,
                "summary": item.summary,
                "source": item.source,
                "published_at": item.published_at,
                "market": item.market,
            }
            for item in news_items[:12]
        ]
        request_payload = {
            "model": settings.model,
            "temperature": 0.2,
            "response_format": {"type": "json_object"},
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are a financial news analyst. "
                        "Return strict JSON with keys summary and keywords. "
                        f"The output language must be {'Simplified Chinese' if wants_chinese else 'English'}. "
                        "summary must be a concise 1-2 sentence market overview. "
                        "keywords must be an array of 5 to 8 short keyword strings."
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "task": (
                                "分析今天的财经资讯并提取最重要的今日关键词。"
                                if wants_chinese
                                else "Analyze today's financial news and extract the most important daily keywords."
                            ),
                            "language": "zh-CN" if wants_chinese else "en-US",
                            "news_items": compact_news,
                        },
                        ensure_ascii=False,
                    ),
                },
            ],
        }
        body = json.dumps(request_payload, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            endpoint,
            data=body,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {settings.api_key}",
                **self.http_headers,
            },
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=max(self.source_timeout_seconds, 25.0)) as response:
            payload = json.load(response)

        choices = payload.get("choices") or []
        if not choices:
            raise ValueError("AI provider returned no choices")

        content = str(
            (choices[0].get("message") or {}).get("content")
            or choices[0].get("text")
            or ""
        ).strip()
        if not content:
            raise ValueError("AI provider returned empty content")

        try:
            return json.loads(content)
        except json.JSONDecodeError as exc:
            raise ValueError(f"AI provider returned non-JSON content: {content[:160]}") from exc

    def _request_openai_compatible_context_json(
        self,
        settings: AiProviderSettings,
        language: str,
        context_type: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        endpoint = self._normalize_openai_compatible_url(settings.base_url)
        normalized_language = language.lower()
        wants_chinese = normalized_language.startswith("zh")

        if context_type == "dashboard":
            task = (
                "你是一名专业股票分析师。请基于当前股票、当前打开时段的K线和快照数据，"
                "给出审慎、专业的盘面分析。返回严格 JSON，包含 title、summary、sentiment、signals、risks。"
                if wants_chinese
                else "You are a professional equity analyst. Analyze the currently selected stock using the opened timeframe, candlestick context, and snapshot metrics. Return strict JSON with title, summary, sentiment, signals, and risks."
            )
        elif context_type == "hotspot":
            task = (
                "你是一名专业市场策略分析师。请基于热点页的市场宽度、指数、涨跌榜和活跃榜，"
                "分析整体行情和市场情绪。返回严格 JSON，包含 title、summary、sentiment、signals、risks。"
                if wants_chinese
                else "You are a professional market strategist. Analyze the overall market regime and sentiment using hotspot breadth, indices, gainers, losers, and active lists. Return strict JSON with title, summary, sentiment, signals, and risks."
            )
        else:
            raise ValueError("Unsupported context type")

        request_payload = {
            "model": settings.model,
            "temperature": 0.2,
            "response_format": {"type": "json_object"},
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "Return strict JSON only. "
                        f"The output language must be {'Simplified Chinese' if wants_chinese else 'English'}. "
                        "title should be a short headline. "
                        "summary should be 2 to 4 concise sentences. "
                        "sentiment should be a short phrase. "
                        "signals must be an array of 3 to 5 concise takeaways. "
                        "risks must be an array of 2 to 4 concise caution points. "
                        "Do not include markdown."
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "task": task,
                            "context_type": context_type,
                            "language": "zh-CN" if wants_chinese else "en-US",
                            "payload": payload,
                        },
                        ensure_ascii=False,
                    ),
                },
            ],
        }
        body = json.dumps(request_payload, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            endpoint,
            data=body,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {settings.api_key}",
                **self.http_headers,
            },
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=max(self.source_timeout_seconds, 30.0)) as response:
            response_payload = json.load(response)

        choices = response_payload.get("choices") or []
        if not choices:
            raise ValueError("AI provider returned no choices")

        content = str(
            (choices[0].get("message") or {}).get("content")
            or choices[0].get("text")
            or ""
        ).strip()
        if not content:
            raise ValueError("AI provider returned empty content")

        try:
            return json.loads(content)
        except json.JSONDecodeError as exc:
            raise ValueError(f"AI provider returned non-JSON content: {content[:160]}") from exc

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

        if not isfinite(number):
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
        volume_ratio: float | None = None,
        pe_ratio: float | None = None,
        pb_ratio: float | None = None,
        market_cap: float | None = None,
    ) -> StockUpdate:
        precision = 3 if ticker.isdigit() and ticker.startswith(("15", "16", "50", "51", "52", "56", "58")) else (4 if not ticker.isdigit() and price < 1 else 2)
        rounded_price = round(price, precision)
        rounded_previous_close = round(previous_close, precision) if previous_close is not None else None
        change_value = (
            round(rounded_price - rounded_previous_close, precision)
            if rounded_previous_close is not None
            else None
        )
        change_percent = (
            round((change_value / rounded_previous_close) * 100, 2)
            if rounded_previous_close not in (None, 0) and change_value is not None
            else 0.0
        )
        rounded_high = round(high_price, precision) if high_price is not None else None
        rounded_low = round(low_price, precision) if low_price is not None else None
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
            open_price=round(open_price, precision) if open_price is not None else None,
            high_price=rounded_high,
            low_price=rounded_low,
            previous_close=rounded_previous_close,
            amount=round(amount, 2) if amount is not None else None,
            turnover_rate=round(turnover_rate, 2) if turnover_rate is not None else None,
            volume_ratio=round(volume_ratio, 2) if volume_ratio is not None else None,
            pe_ratio=round(pe_ratio, 2) if pe_ratio is not None else None,
            pb_ratio=round(pb_ratio, 2) if pb_ratio is not None else None,
            market_cap=round(market_cap, 2) if market_cap is not None else None,
            amplitude_percent=amplitude_percent,
        )

    def normalize_period(self, period: str) -> str:
        aliases = {
            "1w": "5d",
            "1wk": "5d",
            "1m": "1mo",
            "3m": "3mo",
            "12m": "1y",
        }
        return aliases.get(period, period)

    def get_stock_market(self, ticker: str) -> str:
        if ticker.upper() in CN_INDICES or (ticker.isdigit() and len(ticker) == 6):
            return "CN"
        return "US"

    def get_period_spec(self, period: str) -> PeriodSpec:
        return PERIOD_SPECS.get(period, PERIOD_SPECS["1mo"])

    def normalize_interval(self, period: str, interval: str) -> str:
        allowed_by_period = {
            "1d": {"1m", "5m", "15m", "30m", "1h"},
            "5d": {"1m", "5m", "15m", "30m", "1h"},
            "1mo": {"1d"},
            "3mo": {"1d"},
            "1y": {"1d", "1wk"},
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

    def _http_get_json(self, url: str, timeout: float | None = None) -> dict[str, Any]:
        request = urllib.request.Request(url, headers=self.http_headers)
        with urllib.request.urlopen(request, timeout=timeout or self.source_timeout_seconds) as response:
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

    def _strip_tags(self, value: str) -> str:
        return re.sub(r"<[^>]+>", "", value).replace("\u3000", " ").strip()

    def _normalize_news_text(self, value: Any) -> str:
        if value is None:
            return ""
        cleaned = self._strip_tags(str(value))
        return re.sub(r"\s+", " ", cleaned)

    def _build_sina_news_search_url(self, query: Any) -> str | None:
        normalized_query = self._normalize_news_text(query)
        if not normalized_query:
            return None
        return f"https://search.sina.com.cn/?c=news&q={urllib.parse.quote(normalized_query[:80])}"

    def _parse_news_datetime(self, value: Any) -> datetime:
        text = self._normalize_news_text(value)
        if not text:
            return datetime.now(CN_TIMEZONE)

        normalized = text.replace("/", "-").replace("T", " ").strip()
        for fmt in (
            "%Y-%m-%d %H:%M:%S",
            "%Y-%m-%d %H:%M",
            "%Y-%m-%d",
        ):
            try:
                parsed = datetime.strptime(normalized, fmt)
                return parsed.replace(tzinfo=CN_TIMEZONE)
            except ValueError:
                continue

        try:
            parsed = datetime.fromisoformat(normalized)
            return parsed.astimezone(CN_TIMEZONE) if parsed.tzinfo else parsed.replace(tzinfo=CN_TIMEZONE)
        except ValueError:
            return datetime.now(CN_TIMEZONE)

    def _build_news_item(
        self,
        *,
        title: Any,
        summary: Any,
        published_at: Any,
        source: str,
        market: str,
        url: Any = None,
    ) -> FinanceNewsItem | None:
        normalized_title = self._normalize_news_text(title)
        normalized_summary = self._normalize_news_text(summary)
        normalized_url = self._normalize_news_text(url)
        if not normalized_title:
            return None

        if not normalized_summary:
            normalized_summary = normalized_title

        return FinanceNewsItem(
            title=normalized_title,
            summary=normalized_summary[:220],
            published_at=self._parse_news_datetime(published_at).isoformat(),
            source=source,
            url=normalized_url or None,
            market=market,
        )

    def _fetch_news_source(self, source: str) -> list[FinanceNewsItem]:
        if source == "eastmoney":
            params = urllib.parse.urlencode({"client": "web", "biz": "web_724", "fastColumn": "102", "sortEnd": "0", "pageSize": "80", "req_trace": str(int(time.time() * 1000))})
            payload = self._http_get_json("https://np-weblist.eastmoney.com/comm/web/getFastNewsList?" + params)
            rows = (payload.get("data") or {}).get("fastNewsList", [])
            if not rows:
                raise DataSourceUnavailable("Eastmoney returned no news")
            items = [self._build_news_item(
                title=row.get("title"), summary=row.get("summary"), published_at=row.get("showTime"),
                source="东方财富", market="ALL", url=f"https://finance.eastmoney.com/a/{row.get('code')}.html",
            ) for row in rows]
        else:
            payload = self._http_get_json("https://zhibo.sina.com.cn/api/zhibo/feed?page=1&page_size=80&zhibo_id=152&tag_id=0&dire=f&dpc=1&pagesize=80&type=1")
            rows = payload.get("result", {}).get("data", {}).get("feed", {}).get("list", [])
            items = []
            for row in rows:
                content = self._normalize_news_text(row.get("rich_text"))
                try:
                    url = json.loads(row.get("ext") or "{}").get("docurl")
                except (ValueError, TypeError):
                    url = None
                item = self._build_news_item(
                    title=content.split("】")[0].lstrip("【")[:120], summary=content,
                    published_at=row.get("create_time"), source="新浪财经", market="ALL", url=url,
                )
                items.append(item)
        return [item for item in items if item is not None]

    def _extract_news_keywords(self, items: list[FinanceNewsItem], limit: int = 8) -> list[str]:
        counter: Counter[str] = Counter()

        for item in items:
            title = self._normalize_news_text(item.title)

            for token in re.findall(r"[\u4e00-\u9fff]{2,6}", title):
                if token in self.news_keyword_stopwords:
                    continue
                counter[token] += 1

            for token in re.findall(r"[A-Za-z][A-Za-z0-9&.-]{2,20}", title):
                normalized = token.upper() if token.isupper() else token.title()
                if normalized in self.news_keyword_stopwords:
                    continue
                counter[normalized] += 1

        keywords = [
            word for word, _ in counter.most_common(limit * 2)
            if word not in self.news_keyword_stopwords
        ]
        return keywords[:limit]

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

    def _get_cn_exchange_prefix(self, ticker: str) -> str:
        if ticker.upper() in CN_INDICES:
            return ticker[:2].lower()
        if ticker.startswith(("4", "8", "92")):
            return "bj"
        if ticker.startswith(("5", "6", "9")):
            return "sh"
        return "sz"

    def _get_cn_tencent_symbol(self, ticker: str) -> str:
        if ticker.upper() in CN_INDICES:
            return ticker.lower()
        return f"{self._get_cn_exchange_prefix(ticker)}{ticker}"

    def _get_cn_eastmoney_secid(self, ticker: str) -> str:
        market_id = "1" if self._get_cn_exchange_prefix(ticker) == "sh" else "0"
        return f"{market_id}.{ticker[-6:]}"

    async def get_stock_memberships(self, ticker: str) -> dict[str, Any]:
        if not re.fullmatch(r"(?:60|00|30|68)[0-9]{4}|920[0-9]{3}", ticker):
            raise ValueError("Invalid A-share ticker")
        return await self.cn_boards.get_stock_memberships(self._get_cn_eastmoney_secid(ticker))

    def _tencent_quote_metrics(self, fields: list[str], market: str) -> dict[str, float | None]:
        def number(index: int) -> float | None:
            return self._safe_float(fields[index]) if len(fields) > index else None
        def ratio(index: int) -> float | None:
            value = number(index)
            return value if value not in (None, 0) else None
        # Tencent's US schema differs: field 49 is the 52-week low, not volume ratio.
        # Ratios use source values; no daily-volume approximation is substituted.
        volume_ratio = number(49) if market == "CN" else None
        cap = number(45)
        return {
            "volume_ratio": volume_ratio if volume_ratio is not None and volume_ratio >= 0 else None,
            "pe_ratio": ratio(39),
            "pb_ratio": ratio(46) if market == "CN" else None,
            "market_cap": cap * 100_000_000 if cap is not None and cap > 0 else None,
        }

    def _fetch_cn_quote_snapshot_map(self, tickers: list[str]) -> dict[str, dict[str, Any]]:
        unique_tickers = [ticker for ticker in dict.fromkeys(tickers) if ticker]
        if not unique_tickers:
            return {}

        symbols = ",".join(self._get_cn_tencent_symbol(ticker) for ticker in unique_tickers)
        request = urllib.request.Request(
            f"https://qt.gtimg.cn/q={symbols}",
            headers={
                **self.http_headers,
                "Referer": "https://gu.qq.com/",
            },
        )
        with urllib.request.urlopen(request, timeout=self.source_timeout_seconds) as response:
            raw_text = response.read().decode("gbk", errors="ignore")

        quote_map: dict[str, dict[str, Any]] = {}
        for line in raw_text.split(";"):
            cleaned_line = line.strip()
            if "~" not in cleaned_line:
                continue

            fields = cleaned_line.split("~")
            ticker = fields[2].strip() if len(fields) > 2 else ""
            if not ticker:
                continue

            quote_map[ticker] = {
                "name": fields[1].strip() if len(fields) > 1 else ticker,
                "price": self._safe_float(fields[3]) if len(fields) > 3 else None,
                "previous_close": self._safe_float(fields[4]) if len(fields) > 4 else None,
                "open_price": self._safe_float(fields[5]) if len(fields) > 5 else None,
                "volume_lots": self._safe_int(fields[6]) if len(fields) > 6 else 0,
                "change": self._safe_float(fields[31]) if len(fields) > 31 else None,
                "change_percent": self._safe_float(fields[32]) if len(fields) > 32 else None,
                "high_price": self._safe_float(fields[33]) if len(fields) > 33 else None,
                "low_price": self._safe_float(fields[34]) if len(fields) > 34 else None,
                "amount_10k": self._safe_float(fields[37]) if len(fields) > 37 else None,
                "turnover_rate": self._safe_float(fields[38]) if len(fields) > 38 else None,
                **self._tencent_quote_metrics(fields, "CN"),
            }

        return quote_map

    def _get_cn_a_share_universe(self) -> dict[str, str]:
        cached_payload = self._read_json_cache(self.cn_a_share_universe_cache_file)
        if isinstance(cached_payload, dict):
            cached_at = self._safe_float(cached_payload.get("saved_at"))
            cached_rows = cached_payload.get("rows")
            if (
                cached_at is not None
                and time.time() - cached_at < self.cn_full_market_universe_cache_ttl_seconds
                and isinstance(cached_rows, list)
            ):
                universe: dict[str, str] = {}
                for item in cached_rows:
                    if not isinstance(item, dict):
                        continue
                    ticker = str(item.get("ticker") or "").strip()
                    name = str(item.get("name") or "").strip()
                    if ticker and name:
                        universe[ticker] = name
                if universe:
                    return universe

        frame = ak.stock_info_a_code_name()
        if frame is None or getattr(frame, "empty", True):
            raise ValueError("A-share universe returned no rows")

        universe: dict[str, str] = {}
        for _, row in frame.iterrows():
            ticker = str(row.get("code") or "").strip().zfill(6)
            name = str(row.get("name") or "").strip()
            if len(ticker) == 6 and ticker.isdigit() and name:
                universe[ticker] = name

        self._write_json_cache(
            self.cn_a_share_universe_cache_file,
            {
                "saved_at": time.time(),
                "rows": [
                    {"ticker": ticker, "name": name}
                    for ticker, name in sorted(universe.items())
                ],
            },
        )
        return universe

    def _build_cn_hotspot_row(
        self, ticker: str, name: str, quote: dict[str, Any]
    ) -> dict[str, Any] | None:
        price = self._safe_float(quote.get("price"))
        previous_close = self._safe_float(quote.get("previous_close"))
        if price is None or price <= 0 or previous_close is None or previous_close <= 0:
            return None

        change_percent = self._safe_float(quote.get("change_percent"))
        if change_percent is None:
            change_percent = (price - previous_close) / previous_close * 100
        change_value = self._safe_float(quote.get("change"))
        if change_value is None:
            change_value = price - previous_close

        volume = int((quote.get("volume_lots") or 0) * 100)
        amount = (self._safe_float(quote.get("amount_10k")) or 0.0) * 10000

        return {
            "ticker": ticker,
            "name": quote.get("name") or name,
            "price": round(price, 2),
            "change_percent": round(change_percent, 2),
            "change": round(change_value, 2),
            "volume": max(volume, 0),
            "amount": round(amount, 2),
            "amplitude_percent": None,
        }

    def _fetch_cn_full_market_rows(self) -> list[dict[str, Any]]:
        universe = self._get_cn_a_share_universe()
        all_tickers = list(universe.keys())
        rows: list[dict[str, Any]] = []

        chunks = [all_tickers[index:index + 80] for index in range(0, len(all_tickers), 80)]
        with ThreadPoolExecutor(max_workers=6) as pool:
            for chunk, quote_map in zip(chunks, pool.map(self._fetch_cn_quote_snapshot_map, chunks)):
                for ticker in chunk:
                    quote = quote_map.get(ticker)
                    if quote:
                        row = self._build_cn_hotspot_row(ticker, universe[ticker], quote)
                        if row is not None:
                            rows.append(row)
        if len(rows) < len(all_tickers) * 0.95:
            raise DataSourceUnavailable("A-share snapshot coverage below 95 percent")

        if not rows:
            raise ValueError("Tencent full-market snapshot returned no A-share rows")

        return rows

    def _build_cn_full_market_hotspots(self, proxy_rows: list[dict[str, Any]]) -> dict[str, Any]:
        full_market_rows = self._fetch_cn_full_market_rows()
        # Derive breadth from the same quote snapshot, without a second blocking provider.
        advancers = sum(row["change_percent"] > 0 for row in full_market_rows)
        decliners = sum(row["change_percent"] < 0 for row in full_market_rows)
        flat = len(full_market_rows) - advancers - decliners

        index_tickers = set(self.market_hotspot_indices.get("CN", []))
        indices = [row for row in proxy_rows if row["ticker"] in index_tickers]
        sectors = [
            {**row, "sector": self.cn_sector_map.get(row["ticker"], row["name"])}
            for row in proxy_rows
            if row["ticker"] not in index_tickers
        ]
        leaders = sorted(
            full_market_rows,
            key=lambda row: (row["change_percent"], row["amount"], row["volume"]),
            reverse=True,
        )[:5]
        laggards = sorted(
            full_market_rows,
            key=lambda row: (row["change_percent"], -row["amount"], -row["volume"]),
        )[:5]
        active = sorted(
            full_market_rows,
            key=lambda row: (row.get("amount", 0), row["volume"], abs(row["change_percent"])),
            reverse=True,
        )[:5]

        return {
            "market": "CN",
            "indices": indices,
            "sectors": sectors,
            "leaders": leaders,
            "laggards": laggards,
            "active": active,
            "breadth": {
                "advancers": advancers,
                "decliners": decliners,
                "flat": flat,
                "total": advancers + decliners + flat,
            },
            "summary": {
                "market": "CN",
                "mode": "full_market",
                "breadth_ratio": round((advancers / max(advancers + decliners + flat, 1)) * 100, 2),
                "proxy_count": len(sectors),
                "vix": None,
                "vix_change": None,
                "activity_ratio": round(advancers / max(len(full_market_rows), 1) * 100, 2),
                "universe_count": len(full_market_rows),
            },
            "updated_at": datetime.now(UTC).isoformat(),
        }

    def _fetch_cn_intraday_sina(self, ticker: str, interval: str, count: int) -> list[StockDataPoint]:
        scale_map = {"5m": "5", "15m": "15", "30m": "30", "1h": "60"}
        scale = scale_map.get(interval, "5")
        symbol = self._get_cn_tencent_symbol(ticker)
        params = urllib.parse.urlencode(
            {
                "symbol": symbol,
                "scale": scale,
                "ma": "no",
                "datalen": count,
            }
        )
        request = urllib.request.Request(
            "https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?" + params,
            headers={
                **self.http_headers,
                "Referer": "https://finance.sina.com.cn/",
            },
        )
        with urllib.request.urlopen(request, timeout=self.source_timeout_seconds) as response:
            raw_text = response.read().decode("utf-8", errors="ignore")

        payload = json.loads(raw_text)
        points: list[StockDataPoint] = []
        for item in payload:
            timestamp = str(item.get("day") or "")
            if not timestamp:
                continue
            points.append(
                StockDataPoint(
                    timestamp=datetime.fromisoformat(timestamp.replace(" ", "T")).replace(tzinfo=CN_TIMEZONE).isoformat(),
                    open=float(item["open"]),
                    high=float(item["high"]),
                    low=float(item["low"]),
                    close=float(item["close"]),
                    volume=int(float(item.get("volume") or 0)),
                )
            )

        return points

    @staticmethod
    def _regular_session_time(value: datetime, market: str) -> bool:
        minute = value.hour * 60 + value.minute
        if market == "US":
            return 570 <= minute <= 960
        return 570 <= minute <= 690 or 780 <= minute <= 900

    def _parse_tencent_intraday(self, payload: dict, symbol: str, market: str, period: str):
        series = payload.get("data", {}).get(symbol, {})
        raw = series.get("data", {})
        sessions = raw if isinstance(raw, list) else [raw]
        sessions = sorted((day for day in sessions if isinstance(day, dict) and re.fullmatch(r"\d{8}", str(day.get("date", "")))), key=lambda day: day["date"])
        sessions = sessions[-(1 if period == "1d" else 5):]
        zone = CN_TIMEZONE if market == "CN" else US_TIMEZONE
        points = []
        for day in sessions:
            previous_volume = 0
            seen = set()
            for row in day.get("data", []):
                parts = row.split()
                if len(parts) < 3 or not re.fullmatch(r"\d{4}", parts[0]) or parts[0] in seen:
                    continue
                try:
                    moment = datetime.strptime(day["date"] + parts[0], "%Y%m%d%H%M").replace(tzinfo=zone)
                except ValueError:
                    continue
                if not self._regular_session_time(moment, market):
                    continue
                price, cumulative = self._safe_float(parts[1]), self._safe_int(parts[2])
                if price is None or price <= 0 or cumulative is None or cumulative < previous_volume:
                    continue
                multiplier = 100 if market == "CN" else 1
                cumulative_shares = cumulative * multiplier
                volume = (cumulative - previous_volume) * multiplier
                previous_volume = cumulative
                amount = self._safe_float(parts[3]) if len(parts) > 3 else None
                average = amount / cumulative_shares if amount is not None and cumulative_shares > 0 else None
                # These are minute price observations, not invented OHLC candles.
                points.append(StockDataPoint(timestamp=moment.isoformat(), open=price, high=price, low=price,
                    close=price, volume=volume, average_price=average))
                seen.add(parts[0])
        if not points:
            raise DataSourceUnavailable("Minute price observations unavailable")
        reference = self._safe_float(sessions[0].get("prec")) if sessions else None
        if reference is None and period == "1d":
            quote = series.get("qt", {}).get(symbol, [])
            reference = self._safe_float(quote[4]) if len(quote) > 4 else None
        return points, reference

    def _fetch_intraday_tencent(self, ticker: str, period: str, market: str):
        if market == "CN":
            symbol = self._get_cn_tencent_symbol(ticker)
            endpoint = "minute" if period == "1d" else "day"
        else:
            if ticker not in self.us_symbol_map:
                self._fetch_batch_quotes([ticker])
            symbol = "us" + self.us_symbol_map[ticker]
            endpoint = "UsMinute" if period == "1d" else "dayus"
        payload = self._http_get_json(f"https://web.ifzq.gtimg.cn/appstock/app/{endpoint}/query?code={symbol}", 3.0)
        points, reference = self._parse_tencent_intraday(payload, symbol, market, period)
        return points, "Tencent Finance", reference, "snapshot"

    def _fetch_minute_history(self, ticker: str, period: str, market: str):
        return self._hedged_history_fetch(
            lambda: self._fetch_intraday_tencent(ticker, period, market),
            lambda: self._fetch_minute_fallback(ticker, period, market),
        )

    def _hedged_history_fetch(self, primary, fallback, delay=.6):
        pool = ThreadPoolExecutor(max_workers=2)
        first = pool.submit(primary)
        try:
            try:
                result = first.result(timeout=delay)
                if result[0]:
                    return result
            except Exception:
                pass
            second = pool.submit(fallback)
            last_error = None
            for future in as_completed([first, second]):
                try:
                    result = future.result()
                    if result[0]:
                        return result
                except Exception as exc:
                    last_error = exc
            raise DataSourceUnavailable(f"History sources unavailable: {type(last_error).__name__}")
        finally:
            pool.shutdown(wait=False, cancel_futures=True)

    def _fetch_minute_fallback(self, ticker: str, period: str, market: str):
        if market == "US":
            meta, points = self._fetch_us_chart_history(ticker, period, "1m")
            points = [p for p in points if self._regular_session_time(datetime.fromisoformat(p.timestamp).astimezone(US_TIMEZONE), "US")]
            reference = self._safe_float(meta.get("previousClose" if period == "1d" else "chartPreviousClose"))
            return self._trim_points_for_period(points, period), "Yahoo Finance", reference, "ohlc"
        symbol = self._get_cn_eastmoney_secid(ticker)
        params = urllib.parse.urlencode({"secid": symbol, "ndays": "1" if period == "1d" else "5", "iscr": "0",
            "fields1": "f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13", "fields2": "f51,f52,f53,f54,f55,f56,f57,f58"})
        raw = self._http_get_json("https://push2his.eastmoney.com/api/qt/stock/trends2/get?" + params, 3.0).get("data") or {}
        points = []
        for row in raw.get("trends", []):
            values = row.split(",")
            if len(values) < 8:
                continue
            try:
                moment = datetime.fromisoformat(values[0]).replace(tzinfo=CN_TIMEZONE)
                close = float(values[2])
                if not self._regular_session_time(moment, "CN") or close <= 0:
                    continue
                points.append(StockDataPoint(timestamp=moment.isoformat(), open=float(values[1]) or close,
                    high=float(values[3]), low=float(values[4]), close=close, volume=int(float(values[5]) * 100),
                    average_price=self._safe_float(values[7])))
            except (ValueError, TypeError):
                continue
        reference = self._safe_float(raw.get("preClose")) if period == "1d" else None
        return self._trim_points_for_period(points, period), "Eastmoney", reference, "snapshot"

    def _fetch_cn_daily_tencent(self, ticker: str, count: int) -> list[StockDataPoint]:
        symbol = self._get_cn_tencent_symbol(ticker)
        request = urllib.request.Request(
            f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={symbol},day,,,{count},qfq",
            headers={
                **self.http_headers,
                "Referer": "https://finance.qq.com/",
            },
        )
        with urllib.request.urlopen(request, timeout=self.source_timeout_seconds) as response:
            payload = json.load(response)

        data = payload.get("data", {}).get(symbol, {})
        rows = data.get("qfqday") or data.get("day") or []
        points: list[StockDataPoint] = []
        for row in rows:
            if len(row) < 6:
                continue
            points.append(
                StockDataPoint(
                    timestamp=datetime.fromisoformat(f"{row[0]}T00:00:00").replace(tzinfo=CN_TIMEZONE).isoformat(),
                    open=float(row[1]),
                    close=float(row[2]),
                    high=float(row[3]),
                    low=float(row[4]),
                    volume=int(float(row[5]) * 100),
                )
            )

        return points

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
                    open=float(open_price),
                    high=float(high_price),
                    low=float(low_price),
                    close=float(close_price),
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
        pool = ThreadPoolExecutor(max_workers=2)
        futures = [pool.submit(self._http_get_json,
                   f"https://{host}/v8/finance/chart/{ticker}?{params}", 4.0)
                   for host in ("query1.finance.yahoo.com", "query2.finance.yahoo.com")]
        try:
            for future in as_completed(futures):
                try:
                    return self._parse_us_chart_result(future.result())
                except Exception as exc:
                    last_error = exc
        finally:
            pool.shutdown(wait=False, cancel_futures=True)
        raise DataSourceUnavailable(f"US chart API failed for {ticker}: {last_error}")

    def _trim_points_for_period(self, points: list[StockDataPoint], period: str) -> list[StockDataPoint]:
        if not points:
            return []
        points = sorted(points, key=lambda p: p.timestamp)
        if period in {"1d", "5d", "1wk"}:
            # Count actual exchange-local dates, never fixed bar counts.
            dates = sorted({p.timestamp[:10] for p in points})[-(1 if period == "1d" else 5):]
            return [p for p in points if p.timestamp[:10] in dates]
        months = {"1mo": 1, "3mo": 3, "1y": 12}.get(period)
        if months:
            latest = datetime.fromisoformat(points[-1].timestamp)
            index = latest.year * 12 + latest.month - 1 - months
            year, month = divmod(index, 12)
            month += 1
            boundary = latest.replace(year=year, month=month, day=min(latest.day, monthrange(year, month)[1]))
            return [p for p in points if datetime.fromisoformat(p.timestamp) > boundary]
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
            if point.timestamp in seen_timestamps or not all(isfinite(v) and v > 0 for v in (point.open, point.high, point.low, point.close)):
                continue

            high_value = max(point.high, point.open, point.close, point.low)
            low_value = min(point.low, point.open, point.close, point.high)
            sanitized.append(
                StockDataPoint(
                    timestamp=point.timestamp,
                    open=point.open,
                    high=high_value,
                    low=low_value,
                    close=point.close,
                    volume=max(int(point.volume), 0),
                    average_price=point.average_price,
                )
            )
            seen_timestamps.add(point.timestamp)

        return sanitized

    def _fetch_us_history(self, ticker: str, period: str, interval: str) -> tuple[list[StockDataPoint], str]:
        spec = self.get_period_spec(period)
        def yahoo():
            _, points = self._fetch_us_chart_history(ticker, spec.yfinance_period, interval)
            return self._trim_points_for_period(points, period), "Yahoo Finance"
        if period not in {"1d", "5d", "1wk"}:
            def tencent():
                if ticker not in self.us_symbol_map:
                    self._fetch_batch_quotes([ticker])
                symbol = "us" + self.us_symbol_map[ticker]
                count = max(spec.fallback_points + 20, 80)
                payload = self._http_get_json(
                    f"https://web.ifzq.gtimg.cn/appstock/app/usfqkline/get?param={symbol},day,,,{count},qfq", 3.0)
                series = payload.get("data", {}).get(symbol, {})
                rows = series.get("qfqday") or series.get("day") or []
                points = [StockDataPoint(
                    timestamp=datetime.fromisoformat(row[0]).replace(tzinfo=US_TIMEZONE).isoformat(),
                    open=float(row[1]), close=float(row[2]), high=float(row[3]), low=float(row[4]),
                    volume=int(float(row[5])),
                ) for row in rows]
                if len(points) < 2:
                    raise DataSourceUnavailable("US daily history empty")
                # Reject the old ticker alias that can return a decades-old point.
                if (datetime.fromisoformat(points[-1].timestamp) - datetime.fromisoformat(points[-2].timestamp)).days > 10:
                    raise DataSourceUnavailable("US daily history discontinuity")
                return self._trim_points_for_period(points, period), "Tencent Finance"
            return self._hedged_history_fetch(tencent, yahoo)
        return yahoo()

    def _fetch_cn_daily_history(self, ticker: str, period: str) -> list[StockDataPoint]:
        spec = self.get_period_spec(period)
        data = self._fetch_cn_daily_tencent(ticker, max(spec.fallback_points + 20, 80))
        return self._trim_points_for_period(data, period)

    def _fetch_cn_daily_eastmoney(self, ticker: str, period: str):
        params = urllib.parse.urlencode({"secid": self._get_cn_eastmoney_secid(ticker), "klt": "101", "fqt": "1",
            "beg": "0", "end": "20500101", "lmt": "300", "fields1": "f1,f2,f3,f4,f5,f6", "fields2": "f51,f52,f53,f54,f55,f56"})
        raw = self._http_get_json("https://push2his.eastmoney.com/api/qt/stock/kline/get?" + params, 3.0).get("data") or {}
        points = []
        for row in raw.get("klines", []):
            values = row.split(",")
            if len(values) < 6:
                continue
            try:
                points.append(StockDataPoint(timestamp=datetime.fromisoformat(values[0]).replace(tzinfo=CN_TIMEZONE).isoformat(),
                    open=float(values[1]), close=float(values[2]), high=float(values[3]), low=float(values[4]), volume=int(float(values[5]) * 100)))
            except (ValueError, TypeError):
                continue
        return self._trim_points_for_period(points, period), "Eastmoney"

    def _fetch_cn_daily_fast(self, ticker: str, period: str):
        tencent = lambda: (self._fetch_cn_daily_history(ticker, period), "Tencent Finance")
        eastmoney = lambda: self._fetch_cn_daily_eastmoney(ticker, period)
        # Tencent's Beijing day history can contain only the current session.
        return self._hedged_history_fetch(eastmoney, tencent) if self._get_cn_exchange_prefix(ticker) == "bj" else self._hedged_history_fetch(tencent, eastmoney)

    def _fetch_cn_intraday_history(self, ticker: str, period: str, interval: str) -> list[StockDataPoint]:
        spec = self.get_period_spec(period)
        minutes = {"5m": 5, "15m": 15, "30m": 30, "1h": 60}.get(interval, 5)
        point_count = max((240 // minutes + 2) * (2 if period == "1d" else 7), 120)
        data = self._fetch_cn_intraday_sina(ticker, interval, point_count)
        return self._trim_points_for_period(data, period)

    def _fetch_cn_minute_candles(self, ticker: str, period: str, interval: str):
        scale = {"1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60}[interval]
        params = urllib.parse.urlencode({"secid": self._get_cn_eastmoney_secid(ticker), "klt": scale,
            "fqt": 0, "beg": 0, "end": "20500101", "lmt": 2000,
            "fields1": "f1,f2,f3,f4,f5,f6", "fields2": "f51,f52,f53,f54,f55,f56"})
        raw = self._http_get_json("https://push2his.eastmoney.com/api/qt/stock/kline/get?" + params, 3.0).get("data") or {}
        points = []
        for row in raw.get("klines", []):
            values = row.split(",")
            if len(values) < 6:
                continue
            try:
                moment = datetime.fromisoformat(values[0]).replace(tzinfo=CN_TIMEZONE)
                if not self._regular_session_time(moment, "CN"):
                    continue
                points.append(StockDataPoint(timestamp=moment.isoformat(), open=float(values[1]), close=float(values[2]),
                    high=float(values[3]), low=float(values[4]), volume=int(float(values[5]) * 100)))
            except (ValueError, TypeError):
                continue
        return self._trim_points_for_period(points, period), "Eastmoney"

    def _fetch_minute_candles(self, ticker: str, period: str, interval: str, market: str):
        if market == "US":
            _, points = self._fetch_us_chart_history(ticker, period, interval)
            # Yahoo timestamps the start of a candle; 16:00 is a closing snapshot,
            # not an additional regular-session candle.
            points = [p for p in points if self._regular_session_time(datetime.fromisoformat(p.timestamp).astimezone(US_TIMEZONE), "US")
                      and datetime.fromisoformat(p.timestamp).astimezone(US_TIMEZONE).hour < 16]
            return self._trim_points_for_period(points, period), "Yahoo Finance"
        primary = lambda: self._fetch_cn_minute_candles(ticker, period, interval)
        if interval == "1m":
            if period != "1d":
                raise DataSourceUnavailable("A-share one-minute candles are available for the latest session")
            return primary()
        return self._hedged_history_fetch(primary,
            lambda: (self._fetch_cn_intraday_history(ticker, period, interval), "Sina Finance"))

    async def _run_with_timeout(
        self, func: Any, *args: Any, timeout: float | None = None
    ) -> Any:
        return await asyncio.wait_for(
            asyncio.to_thread(func, *args),
            timeout=timeout or self.source_timeout_seconds,
        )

    async def get_historical_data(
        self, ticker: str, period: str = "1mo", interval: str = "1d", candles: bool = False
    ) -> StockHistoryResponse:
        period = self.normalize_period(period)
        interval = self.normalize_interval(period, interval)
        candles = candles and period in {"1d", "5d"}
        key = f"{ticker}:{period}:{interval}" + (":ohlc" if candles else "")
        cached = self.history_cache.get(key)
        now = time.time()
        ttl = 5.0 if period in {"1d", "5d"} else self.history_cache_ttl_seconds
        if cached and now - cached[0] < ttl:
            return cached[1]
        if cached and now - cached[0] < self.market_hotspot_stale_ttl_seconds:
            if key not in self.history_refresh_tasks and now >= self.history_retry_after.get(key, 0):
                self.history_refresh_tasks[key] = asyncio.create_task(self._refresh_history(key, ticker, period, interval, candles))
            return cached[1].model_copy(update={"stale": True})
        async with self.history_locks.setdefault(key, asyncio.Lock()):
            return await self._get_historical_data(ticker, period, interval, candles)

    async def _refresh_history(self, key, ticker, period, interval, candles=False):
        try:
            async with self.history_locks.setdefault(key, asyncio.Lock()):
                result = await self._get_historical_data(ticker, period, interval, candles)
            if result.stale:
                self.history_retry_after[key] = time.time() + 15
            else:
                self.history_retry_after.pop(key, None)
        except Exception:
            self.history_retry_after[key] = time.time() + 15
        finally:
            self.history_refresh_tasks.pop(key, None)

    async def _get_historical_data(
        self, ticker: str, period: str, interval: str, candles: bool = False
    ) -> StockHistoryResponse:
        period = self.normalize_period(period)
        interval = self.normalize_interval(period, interval)
        market = self.get_stock_market(ticker)
        cache_key = f"{ticker}:{period}:{interval}" + (":ohlc" if candles else "")
        now = time.time()
        cached_history = self.history_cache.get(cache_key)
        intraday = period in {"1d", "5d"}
        ttl = 5.0 if intraday else self.history_cache_ttl_seconds
        if cached_history and now - cached_history[0] < ttl:
            return cached_history[1]

        source = "Tencent Finance"
        reference = None
        price_type = "ohlc"
        try:
            if intraday and candles:
                data, source = await self._run_with_timeout(self._fetch_minute_candles, ticker, period, interval, market, timeout=10.0)
            elif intraday and interval == "1m":
                data, source, reference, price_type = await self._run_with_timeout(self._fetch_minute_history, ticker, period, market, timeout=12.0)
            elif market == "US":
                data, source = await self._run_with_timeout(self._fetch_us_history, ticker, period, interval, timeout=10.0)
            elif intraday:
                data = await self._run_with_timeout(self._fetch_cn_intraday_history, ticker, period, interval)
                source = "Sina Finance"
            else:
                data, source = await self._run_with_timeout(self._fetch_cn_daily_fast, ticker, period, timeout=8.0)
        except Exception as exc:
            print(f"Error fetching {market} historical data for {ticker}: {exc}")
            data = []

        if not data:
            if cached_history and now - cached_history[0] < self.market_hotspot_stale_ttl_seconds:
                  return cached_history[1].model_copy(update={"stale": True})
            raise DataSourceUnavailable(f"Historical data unavailable for {ticker}")

        if period == "1d":
            latest_session_data = self._filter_points_to_latest_session(data, market)
            if latest_session_data:
                data = latest_session_data

        data = self._sanitize_history_points(data)
        if not data:
            raise DataSourceUnavailable(f"Historical data empty for {ticker}")
        if ticker in CN_INDICES:
            # Aggregate turnover per share is in yuan; an index is quoted in points.
            data = [point.model_copy(update={"average_price": None}) if point.average_price is not None else point for point in data]
        fetched_at = datetime.now(UTC).isoformat()
        response = StockHistoryResponse(
            ticker=ticker, data=data,
            source=source, interval=interval, price_type=price_type,
            adjustment="qfq" if not intraday and ticker not in CN_INDICES and source in {"Tencent Finance", "Eastmoney"} else "none", reference_price=reference,
            as_of=data[-1].timestamp, fetched_at=fetched_at,
        )
        self.history_cache[cache_key] = (time.time(), response)
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

        update = self._build_stock_update(
            ticker=ticker,
            price=self._safe_float(meta.get("regularMarketPrice")) or latest.close,
            volume=self._safe_int(meta.get("regularMarketVolume")) or latest.volume,
            previous_close=previous_close,
            open_price=self._safe_float(meta.get("regularMarketOpen")) or latest.open,
            high_price=self._safe_float(meta.get("regularMarketDayHigh")) or latest.high,
            low_price=self._safe_float(meta.get("regularMarketDayLow")) or latest.low,
        )

        timestamp = self._safe_float(meta.get("regularMarketTime"))
        return update.model_copy(update={
            "source": "Yahoo Finance", "fetched_at": datetime.now(UTC).isoformat(),
            "as_of": datetime.fromtimestamp(timestamp, UTC).isoformat() if timestamp else latest.timestamp,
            "delay_note": "免费源可能延迟，以报价时间为准",
        })

    def _fetch_cn_quote(self, ticker: str) -> StockUpdate:
        quote = self._fetch_cn_quote_snapshot_map([ticker]).get(ticker)
        if not quote or quote.get("price") is None:
            raise ValueError(f"CN quote not found for {ticker}")

        volume_lots = int(quote.get("volume_lots") or 0)
        return self._build_stock_update(
            ticker=ticker,
            price=float(quote["price"]),
            volume=volume_lots * 100,
            previous_close=quote.get("previous_close"),
            open_price=quote.get("open_price"),
            high_price=quote.get("high_price"),
            low_price=quote.get("low_price"),
            amount=(quote.get("amount_10k") or 0) * 10000 if quote.get("amount_10k") is not None else None,
            turnover_rate=quote.get("turnover_rate"),
            **{key: quote.get(key) for key in ("volume_ratio", "pe_ratio", "pb_ratio", "market_cap")},
        )

    def _fetch_batch_quotes(self, tickers: list[str]) -> dict[str, StockUpdate]:
        symbols = [self._get_cn_tencent_symbol(ticker) if self.get_stock_market(ticker) == "CN"
                   else "us" + ticker.replace("-", ".") for ticker in tickers]
        request = urllib.request.Request(
            "https://qt.gtimg.cn/q=" + ",".join(symbols),
            headers={**self.http_headers, "Referer": "https://gu.qq.com/"},
        )
        with urllib.request.urlopen(request, timeout=3.0) as response:
            raw = response.read().decode("gbk", errors="replace")
        symbol_map = dict(zip(symbols, tickers))
        quotes: dict[str, StockUpdate] = {}
        fetched_at = datetime.now(UTC).isoformat()
        for line in raw.split(";"):
            match = re.search(r'v_([\w.]+)="(.*)"', line.strip())
            if not match or match[1] not in symbol_map:
                continue
            ticker = symbol_map[match[1]]
            fields = match[2].split("~")
            if len(fields) < 39:
                continue
            price = self._safe_float(fields[3])
            previous_close = self._safe_float(fields[4])
            if price is None or price <= 0 or previous_close is None or previous_close <= 0:
                continue
            market = self.get_stock_market(ticker)
            if market == "US":
                self.us_symbol_map[ticker] = fields[2]
            try:
                if market == "CN":
                    as_of = datetime.strptime(fields[30], "%Y%m%d%H%M%S").replace(tzinfo=CN_TIMEZONE)
                else:
                    as_of = datetime.strptime(fields[30], "%Y-%m-%d %H:%M:%S").replace(tzinfo=US_TIMEZONE)
            except ValueError:
                continue
            update = self._build_stock_update(
                ticker=ticker, price=price, previous_close=previous_close,
                volume=(self._safe_int(fields[6]) or 0) * (100 if market == "CN" else 1),
                open_price=self._safe_float(fields[5]),
                high_price=self._safe_float(fields[33]), low_price=self._safe_float(fields[34]),
                amount=(self._safe_float(fields[37]) or 0) * (10000 if market == "CN" else 1),
                turnover_rate=self._safe_float(fields[38]),
                **self._tencent_quote_metrics(fields, market),
            )
            book = None
            if market == "CN" and ticker not in CN_INDICES:
                def levels(start):
                    rows = []
                    for level in range(5):
                        level_price = self._safe_float(fields[start + level * 2])
                        lots = self._safe_int(fields[start + level * 2 + 1])
                        if level_price is not None and level_price > 0 and lots is not None and lots > 0:
                            rows.append({"level": level + 1, "price": level_price, "volume": lots * 100})
                    return rows
                book = OrderBook(bids=levels(9), asks=levels(19))
            quotes[ticker] = update.model_copy(update={
                "name": CN_INDICES.get(ticker, fields[1].strip()) if market == "CN" else None,
                "source": "Tencent Finance", "as_of": as_of.isoformat(), "fetched_at": fetched_at,
                "delay_note": "免费源可能延迟，未验证交易所实时授权" if market == "US" else "以源站报价时间为准",
                "order_book": book,
            })
        return quotes

    async def get_quote_batch(self, tickers: list[str]) -> dict[str, StockUpdate]:
        tickers = list(dict.fromkeys(ticker.strip().upper() for ticker in tickers if ticker.strip()))
        if len(tickers) > 100:
            raise ValueError("A maximum of 100 tickers is supported per request")
        if any(not re.fullmatch(r"[A-Z0-9^][A-Z0-9.^-]{0,19}", ticker) for ticker in tickers):
            raise ValueError("Invalid ticker")
        async with self.quote_refresh_lock:
            now = time.time()
            missing = [ticker for ticker in tickers if ticker not in self.quote_cache
                       or now - self.quote_cache[ticker][0] >= self.quote_cache_ttl_seconds]
            if missing:
                try:
                    updates = await self._run_with_timeout(self._fetch_batch_quotes, missing, timeout=4.0)
                except Exception as exc:
                    print(f"Batch quote source unavailable: {type(exc).__name__}: {exc}")
                    updates = {}
                # Yahoo remains an independent fallback for unsupported US symbols.
                fallback_tickers = [ticker for ticker in missing if ticker not in updates
                                    and self.get_stock_market(ticker) == "US"]
                if fallback_tickers:
                    fallback = await asyncio.gather(*(
                        self._run_with_timeout(self._fetch_us_quote, ticker) for ticker in fallback_tickers
                    ), return_exceptions=True)
                    for ticker, update in zip(fallback_tickers, fallback):
                        if not isinstance(update, Exception):
                            updates[ticker] = update
                for ticker, update in updates.items():
                    self.quote_cache[ticker] = (time.time(), update)
            result = {}
            for ticker in tickers:
                cached = self.quote_cache.get(ticker)
                if cached and time.time() - cached[0] < self.quote_stale_ttl_seconds:
                    result[ticker] = cached[1].model_copy(update={
                        "stale": time.time() - cached[0] >= self.quote_cache_ttl_seconds,
                    })
            return result

    async def get_real_time_data(self, ticker: str) -> StockUpdate:
        normalized = ticker.strip().upper()
        quotes = await self.get_quote_batch([normalized])
        if normalized not in quotes:
            raise DataSourceUnavailable(f"Quote unavailable for {normalized}")
        return quotes[normalized]

    async def get_finance_news(
        self, market: str = "ALL", limit: int = 200
    ) -> FinanceNewsResponse:
        normalized_market = market.upper()
        cache_key = f"{normalized_market}:{limit}"
        now = time.time()
        cached_news = self.news_cache.get(cache_key)
        if cached_news and now - cached_news[0] < self.news_cache_ttl_seconds:
            return cached_news[1]

        feeds = await asyncio.gather(*(
            self._run_with_timeout(self._fetch_news_source, source, timeout=7.0)
            for source in ("eastmoney", "sina")
        ), return_exceptions=True)
        items = [item for feed in feeds if not isinstance(feed, Exception) for item in feed]
        if not items:
            if cached_news and now - cached_news[0] < 3600:
                return cached_news[1].model_copy(update={"stale": True})
            raise DataSourceUnavailable("Financial news sources unavailable")
        if normalized_market in {"CN", "US"}:
            keywords = ("美股", "美联储", "纳指", "标普", "道指", "美元", "美债") if normalized_market == "US" else ("A股", "沪指", "深证", "上证", "创业板", "科创", "人民币")
            items = [item for item in items if any(word in item.title + item.summary for word in keywords)]

        shanghai_today = datetime.now(CN_TIMEZONE).date()
        deduped_items: list[FinanceNewsItem] = []
        seen_pairs: set[str] = set()
        for item in sorted(items, key=lambda news: news.published_at, reverse=True):
            dedupe_key = f"{item.title}|{item.source}"
            if dedupe_key in seen_pairs:
                continue
            seen_pairs.add(dedupe_key)
            deduped_items.append(item)

        today_items = [
            item
            for item in deduped_items
            if datetime.fromisoformat(item.published_at).astimezone(CN_TIMEZONE).date() == shanghai_today
        ]
        visible_items = today_items[:limit] if today_items else deduped_items[:limit]

        keywords = self._extract_news_keywords(visible_items, limit=8)

        response = FinanceNewsResponse(
            market=normalized_market if normalized_market in {"CN", "US"} else "ALL",
            updated_at=datetime.now(UTC).isoformat(),
            keywords=keywords,
            items=visible_items,
        )
        self.news_cache[cache_key] = (now, response)
        return response

    async def get_finance_news_ai_insights(
        self, payload: FinanceNewsAiRequest
    ) -> FinanceNewsAiResponse:
        if not payload.settings.api_key.strip():
            raise ValueError("API key is required")
        if not payload.settings.base_url.strip():
            raise ValueError("Base URL is required")
        if not payload.settings.model.strip():
            raise ValueError("Model is required")
        if not payload.items:
            raise ValueError("News items are required")

        result = await self._run_with_timeout(
            self._request_openai_compatible_json,
            payload.settings,
            payload.language,
            payload.items,
            timeout=max(self.source_timeout_seconds, 30.0),
        )
        raw_keywords = result.get("keywords") or []
        summary = self._normalize_news_text(result.get("summary"))
        keywords = [
            self._normalize_news_text(keyword)
            for keyword in raw_keywords
            if self._normalize_news_text(keyword)
        ][:8]

        if not keywords:
            keywords = self._extract_news_keywords(payload.items, limit=8)
        if not summary:
            summary = "AI identified the key market themes from today's financial news flow."

        return FinanceNewsAiResponse(
            provider=payload.settings.provider,
            model=payload.settings.model,
            language=payload.language,
            analyzed_at=datetime.now(UTC).isoformat(),
            summary=summary,
            keywords=keywords,
        )

    async def get_ai_context_analysis(
        self, payload: AiContextAnalysisRequest
    ) -> AiContextAnalysisResponse:
        if not payload.settings.api_key.strip():
            raise ValueError("API key is required")
        if not payload.settings.base_url.strip():
            raise ValueError("Base URL is required")
        if not payload.settings.model.strip():
            raise ValueError("Model is required")
        if payload.context_type not in {"dashboard", "hotspot"}:
            raise ValueError("Unsupported context type")
        if not payload.payload:
            raise ValueError("Analysis payload is required")

        result = await self._run_with_timeout(
            self._request_openai_compatible_context_json,
            payload.settings,
            payload.language,
            payload.context_type,
            payload.payload,
            timeout=max(self.source_timeout_seconds, 35.0),
        )

        wants_chinese = payload.language.lower().startswith("zh")
        title = self._normalize_news_text(result.get("title"))
        summary = self._normalize_news_text(result.get("summary"))
        sentiment = self._normalize_news_text(result.get("sentiment"))
        signals = [
            self._normalize_news_text(item)
            for item in (result.get("signals") or [])
            if self._normalize_news_text(item)
        ][:5]
        risks = [
            self._normalize_news_text(item)
            for item in (result.get("risks") or [])
            if self._normalize_news_text(item)
        ][:4]

        if not title:
            title = "AI 盘面分析" if wants_chinese and payload.context_type == "dashboard" else (
                "AI 市场情绪分析" if wants_chinese else (
                    "AI Trading View" if payload.context_type == "dashboard" else "AI Market Sentiment"
                )
            )
        if not summary:
            summary = (
                "AI 已结合当前盘面给出简要解读，建议结合成交量、波动率和风险承受能力综合判断。"
                if wants_chinese
                else "The AI generated a concise market interpretation. Pair it with volume, volatility, and your own risk tolerance before acting."
            )
        if not sentiment:
            sentiment = "中性观察" if wants_chinese else "Neutral watch"

        return AiContextAnalysisResponse(
            provider=payload.settings.provider,
            model=payload.settings.model,
            language=payload.language,
            context_type=payload.context_type,
            analyzed_at=datetime.now(UTC).isoformat(),
            title=title,
            summary=summary,
            sentiment=sentiment,
            signals=signals,
            risks=risks,
        )

    async def get_recommendations(self, ticker: str) -> list[str]:
        industry = self.industry_map.get(ticker)
        if not industry:
            return []
        recommendations = [
            symbol
            for symbol, symbol_industry in self.industry_map.items()
            if symbol_industry == industry and symbol != ticker
            and self.get_stock_market(symbol) == self.get_stock_market(ticker)
        ]
        return recommendations[:5]

    async def search_stocks(self, query: str, market: str) -> list[dict[str, str]]:
        query = query.strip()[:100]
        market = market.upper()
        if not query or market not in {"US", "CN"}:
            return []
        key = f"{market}:{query.casefold()}"
        cached = self.search_cache.get(key)
        if cached and time.time() - cached[0] < 60:
            return cached[1]
        results = await self._search_stocks(query, market)
        if results:
            if len(self.search_cache) >= 256:
                self.search_cache.pop(next(iter(self.search_cache)))
            self.search_cache[key] = (time.time(), results)
        return results

    async def _search_stocks(self, query: str, market: str) -> list[dict[str, str]]:
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
            local = [stock for stock in us_stocks
                     if query.lower() in stock["ticker"].lower() or query.lower() in stock["name"].lower()]
            try:
                raw = await self._run_with_timeout(self._http_get_text,
                    "https://smartbox.gtimg.cn/s3/?" + urllib.parse.urlencode({"q": query, "t": "us"}), timeout=4.0)
                match = re.search(r'v_hint="(.*)"', raw, re.S)
                hints = json.loads('"' + match[1] + '"') if match else ""
                found = []
                for hint in hints.split("^"):
                    fields = hint.split("~")
                    if len(fields) < 3 or fields[0] != "us":
                        continue
                    ticker = fields[1].rsplit(".", 1)[0].upper().replace(".", "-")
                    if re.fullmatch(r"[A-Z][A-Z0-9-]{0,14}", ticker):
                        found.append({"ticker": ticker, "name": fields[2]})
                merged = {stock["ticker"]: stock for stock in local}
                merged.update({stock["ticker"]: stock for stock in found})
                return sorted(merged.values(), key=lambda stock: stock["ticker"].upper() != query.upper())[:12]
            except Exception as exc:
                print(f"US search source unavailable: {exc}")
                return local

        indices = [{"ticker": ticker, "name": name} for ticker, name in CN_INDICES.items()
                   if query.casefold() in (ticker + " " + name).casefold()]
        if len(indices) == 1 and query.casefold() in {indices[0]["ticker"].casefold(), indices[0]["name"].casefold()}:
            return indices
        try:
            params = urllib.parse.urlencode(
                {
                    "input": query,
                    "type": "14",
                    "token": "D43BF722C8E33BDC906FB84D85E326E8",
                }
            )
            request = urllib.request.Request(
                f"https://searchapi.eastmoney.com/api/suggest/get?{params}",
                headers={
                    **self.http_headers,
                    "Referer": "https://quote.eastmoney.com/",
                },
            )
            payload = await self._run_with_timeout(self._http_get_json, request.full_url)
            entries = payload.get("QuotationCodeTable", {}).get("Data") or []
            for item in entries[:20]:
                ticker = str(item.get("Code") or "").strip()
                name = str(item.get("Name") or "").strip()
                classify = str(item.get("Classify") or "")
                if not ticker or not name or classify not in {"AStock", "Fund"} or not (len(ticker) == 6 and ticker.isdigit()):
                    continue
                if classify == "Fund" and str(item.get("MktNum") or item.get("MarketType")) not in {"0", "1"}:
                    continue
                results.append({"ticker": ticker, "name": name})
            if results:
                return (results + indices)[:12]
            raise ValueError("CN search returned empty")
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
            cached = self._read_json_cache(self.cn_a_share_universe_cache_file) or {}
            directory = {stock["ticker"]: stock for stock in cached.get("rows", []) if isinstance(stock, dict) and stock.get("ticker")}
            for stock in cn_stocks + self.market_hotspot_universe.get("CN", []):
                directory[stock["ticker"]] = stock
            local = [stock for stock in directory.values()
                     if query.casefold() in (stock.get("ticker", "") + " " + stock.get("name", "")).casefold()]
            return (local + indices)[:12]

    async def _get_hotspot_proxy_rows(self, market: str) -> list[dict[str, Any]]:
        universe = self.market_hotspot_universe.get(market, self.market_hotspot_universe["US"])
        # VIX is unavailable from the primary free batch feed; do not delay all ETFs for it.
        universe = [item for item in universe if item["ticker"] != "^VIX"]
        quotes = await self.get_quote_batch([item["ticker"] for item in universe])
        return [{**quotes[item["ticker"]].model_dump(), "name": quotes[item["ticker"]].name or item["name"]}
                for item in universe if item["ticker"] in quotes]

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
            screeners = await asyncio.gather(*(
                self._run_with_timeout(self._fetch_yahoo_screener_rows, name, 5)
                for name in ("day_gainers", "day_losers", "most_actives")
            ), return_exceptions=True)
            ranked = sorted(sectors, key=lambda row: row["change_percent"], reverse=True)
            leaders, laggards, active = [
                result if not isinstance(result, Exception) else fallback
                for result, fallback in zip(screeners, (ranked[:5], ranked[-5:][::-1], sorted(sectors, key=lambda row: row["volume"], reverse=True)[:5]))
            ]
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

    async def _refresh_hotspots(self, market: str) -> None:
        try:
            if market == "CN":
                proxy_rows = await self._get_hotspot_proxy_rows(market)
                response = await self._run_with_timeout(self._build_cn_full_market_hotspots, proxy_rows, timeout=45.0)
            elif self.polygon_api_key:
                proxy_rows = await self._get_hotspot_proxy_rows(market)
                response = await self._run_with_timeout(self._build_us_full_market_hotspots, proxy_rows, timeout=20.0)
            else:
                response = await self._build_proxy_market_hotspots(market)
            response["source"] = "Tencent Finance" if market == "CN" else "Tencent Finance / Yahoo Finance"
            response["stale"] = False
            self._store_market_hotspot_cache(market, response)
        except Exception as exc:
            print(f"Background market refresh {market}: {type(exc).__name__}: {exc}")

    async def get_market_hotspots(self, market: str) -> dict[str, Any]:
        normalized_market = market.upper()
        if normalized_market not in {"CN", "US"}:
            raise ValueError("Market must be CN or US")
        cached = self._load_market_hotspot_cache(normalized_market, self.market_hotspot_stale_ttl_seconds)
        if cached is None:
            response = await self._build_proxy_market_hotspots(normalized_market)
            response["source"] = "Tencent Finance" if normalized_market == "CN" else "Tencent Finance / Yahoo Finance"
            response["stale"] = False
            self._store_market_hotspot_cache(normalized_market, response)
            cached = response
        age = time.time() - self.market_hotspot_cache[normalized_market][0]
        threshold = 30.0 if normalized_market == "CN" else 15.0
        needs_refresh = age >= threshold or (normalized_market == "CN" and cached.get("summary", {}).get("mode") != "full_market")
        task = self.hotspot_tasks.get(normalized_market)
        # Retry a failed full-market upgrade at most every 30 seconds.
        if needs_refresh and (task is None or task.done()) and time.time() - self.hotspot_attempts.get(normalized_market, 0) >= threshold:
            self.hotspot_attempts[normalized_market] = time.time()
            self.hotspot_tasks[normalized_market] = asyncio.create_task(self._refresh_hotspots(normalized_market))
        return {**cached, "stale": age >= threshold, "refreshing": bool(self.hotspot_tasks.get(normalized_market) and not self.hotspot_tasks[normalized_market].done())}
