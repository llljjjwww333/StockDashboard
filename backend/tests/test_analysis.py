import asyncio
from datetime import datetime, timedelta, timezone
import io
import json
import os
import unittest
from unittest.mock import AsyncMock, patch
import urllib.error

from app.schemas.analysis import AnalysisRequest, ProviderConfig
from app.schemas.stock import FinanceNewsItem, FinanceNewsResponse, StockDataPoint, StockHistoryResponse, StockUpdate
from app.services.analysis_service import (ProviderError, analyze_market, chart_evidence, provider_endpoint, request_model, validate_result)
from app.services.stock_data_service import DataSourceUnavailable


def bars(count=40):
    start = datetime(2026, 10, 1, tzinfo=timezone.utc)
    return [StockDataPoint(timestamp=(start + timedelta(days=i)).isoformat(), open=100 + i,
                           high=102 + i, low=99 + i, close=101 + i, volume=1000 + i * 10) for i in range(count)]


def config(**kwargs):
    return ProviderConfig(provider="Test", base_url="https://provider.example/v1", model="test-model", api_key="secret-fixture", **kwargs)


class ProviderTests(unittest.TestCase):
    @patch.dict(os.environ, {"AI_ALLOW_LOCAL_PROVIDER": "0"})
    def test_private_and_credential_urls_are_blocked(self):
        for url in ("http://127.0.0.1:8000", "http://169.254.169.254", "file:///tmp/secret", "https://key@provider.example", "https://provider.example?key=secret"):
            with self.assertRaises((ValueError, ProviderError)):
                provider_endpoint(ProviderConfig(base_url=url, model="x"))

    @patch.dict(os.environ, {"AI_ALLOW_LOCAL_PROVIDER": "1"})
    def test_provider_endpoint_accepts_base_and_full_urls(self):
        self.assertEqual(provider_endpoint(config()), "https://provider.example/v1/chat/completions")
        p = config(protocol="anthropic")
        self.assertEqual(provider_endpoint(p), "https://provider.example/v1/messages")
        p.base_url = "https://provider.example/chat/completions"
        p.protocol = "chat"
        self.assertEqual(provider_endpoint(p), p.base_url)

    @patch.dict(os.environ, {"AI_ALLOW_LOCAL_PROVIDER": "1"})
    def test_chat_and_messages_response_formats(self):
        for protocol, payload in (
            ("chat", {"choices": [{"message": {"content": '```json\n{"summary":"ok"}\n```'}}]}),
            ("anthropic", {"content": [{"type": "text", "text": '{"summary":"ok"}'}]}),
        ):
            opener = unittest.mock.Mock()
            opener.open.return_value = io.BytesIO(json.dumps(payload).encode())
            with patch("urllib.request.build_opener", return_value=opener):
                result = request_model(config(protocol=protocol), "system", {"test": True})
            self.assertEqual(result["summary"], "ok")
            request = opener.open.call_args.args[0]
            self.assertNotIn("secret-fixture", request.full_url)
            self.assertIn("test-model", request.data.decode())

    @patch.dict(os.environ, {"AI_ALLOW_LOCAL_PROVIDER": "1"})
    def test_provider_error_does_not_echo_key_or_error_body(self):
        opener = unittest.mock.Mock()
        opener.open.side_effect = urllib.error.HTTPError("https://provider.example", 401, "bad", {}, io.BytesIO(b"secret-fixture"))
        with patch("urllib.request.build_opener", return_value=opener):
            with self.assertRaises(ProviderError) as result:
                request_model(config(), "system", {})
        self.assertNotIn("secret-fixture", str(result.exception))

    @patch.dict(os.environ, {"AI_ALLOW_LOCAL_PROVIDER": "1"})
    def test_json_mode_fallback_is_limited_to_explicit_parameter_error(self):
        opener = unittest.mock.Mock()
        opener.open.side_effect = [
            urllib.error.HTTPError("https://provider.example", 400, "bad", {}, io.BytesIO(b"response_format unsupported")),
            io.BytesIO(json.dumps({"choices": [{"message": {"content": '{"summary":"ok"}'}}]}).encode()),
        ]
        with patch("urllib.request.build_opener", return_value=opener):
            self.assertEqual(request_model(config(), "system", {})["summary"], "ok")
        self.assertEqual(opener.open.call_count, 2)
        self.assertNotIn("response_format", json.loads(opener.open.call_args.args[0].data))


class EvidenceTests(unittest.TestCase):
    def test_indicators_and_candidates_are_anchored_to_actual_bars(self):
        points = bars()
        indicators, candidates = chart_evidence(points)
        self.assertEqual(indicators["ma20"], sum(p.close for p in points[-20:]) / 20)
        self.assertEqual(indicators["rsi14"], 100)
        self.assertEqual(indicators["macd"], 7)
        self.assertEqual(indicators["macd_signal"], 7)
        self.assertIsNone(indicators["ma60"])
        for candidate in candidates.values():
            self.assertEqual(candidate["timestamp"], points[candidate["index"]].timestamp)
            self.assertGreaterEqual(candidate["price"], points[candidate["index"]].low)
            self.assertLessEqual(candidate["price"], points[candidate["index"]].high)

    def test_model_cannot_invent_dates_prices_or_annotation_ids(self):
        _, candidates = chart_evidence(bars())
        identifier = next(iter(candidates))
        result = validate_result({"summary": "fixture", "annotations": [
            {"id": "invented", "price": 999999}, {"id": ["invalid"]},
            {"id": identifier, "price": 999999, "timestamp": "2099-01-01", "label": "支撑"},
            {"id": identifier, "label": "重复"},
        ]}, candidates, "chart")
        self.assertEqual(len(result["annotations"]), 1)
        annotation = result["annotations"][0]
        self.assertEqual(annotation.price, candidates[identifier]["price"])
        self.assertEqual(annotation.timestamp, candidates[identifier]["timestamp"])

    def test_empty_model_output_is_an_error_instead_of_synthetic_analysis(self):
        with self.assertRaises(ProviderError):
            validate_result({}, {}, "news")
        with self.assertRaises(ProviderError):
            validate_result({"summary": "ok", "annotations": [{"id": "fake"}]}, {}, "chart")

    def test_trendlines_require_distinct_chronological_anchors_from_same_kind(self):
        candidates = {
            key: {"id": key, "index": index, "timestamp": f"2026-11-0{index + 1}", "price": price, "kind": kind}
            for key, index, price, kind in (
                ("low-a", 0, 10, "support"), ("low-b", 1, 11, "support"), ("high", 2, 14, "resistance"),
            )
        }
        output = {"summary": "Test", "annotations": [{"id": "low-a"}], "trendlines": [
            {"start_id": "low-b", "end_id": "low-a"},
            {"start_id": "low-a", "end_id": "high"},
            {"start_id": "low-a", "end_id": "fake"},
            {"start_id": "low-a", "end_id": "low-b", "price": 999, "detail": "Rising lows"},
            {"start_id": "low-a", "end_id": "low-b"},
        ]}
        result = validate_result(output, candidates, "chart", "en")
        self.assertEqual(len(result["trendlines"]), 1)
        line = result["trendlines"][0]
        self.assertEqual(line.label, "Support trendline")
        self.assertEqual(line.start.price, 10)
        self.assertEqual(line.end.timestamp, "2026-11-02")
        self.assertEqual(validate_result(output, candidates, "news")["trendlines"], [])

    def test_english_annotation_fallback_keeps_grounded_candidate(self):
        _, candidates = chart_evidence(bars())
        candidate = next(c for c in candidates.values() if c["kind"] == "support")
        result = validate_result({"summary": "Test", "annotations": [{"id": candidate["id"]}]}, candidates, "chart", "en")
        self.assertEqual(result["annotations"][0].label, "Support")
        self.assertEqual(result["annotations"][0].price, candidate["price"])


class AnalysisTests(unittest.IsolatedAsyncioTestCase):
    def service(self):
        service = unittest.mock.Mock()
        service.get_stock_market.return_value = "US"
        service.get_finance_news = AsyncMock(return_value=FinanceNewsResponse(market="ALL", updated_at="2026-11-01", keywords=[], items=[
            FinanceNewsItem(title="Test economy", summary="data", published_at="2026-11-01T10:00:00Z", source="Fixture", market="ALL"),
        ]))
        service.get_market_hotspots = AsyncMock(return_value={"summary": {"mode": "proxy"}, "indices": []})
        service.get_historical_data = AsyncMock(return_value=StockHistoryResponse(ticker="AAPL", data=bars(), source="TEST FIXTURE"))
        service.get_real_time_data = AsyncMock(return_value=StockUpdate(ticker="AAPL", price=140, volume=1000, change_percent=1))
        return service

    async def test_chart_request_uses_requested_period_and_server_fetched_context(self):
        service = self.service()
        def model(settings, system, evidence):
            self.assertEqual(evidence["period"], "1d")
            self.assertEqual(evidence["interval"], "5m")
            self.assertEqual(len(evidence["bars"]), 40)
            self.assertEqual(len(evidence["news"]), 1)
            return {"summary": "test", "annotations": [{"id": evidence["candidates"][0]["id"], "label": "支撑"}]}
        with patch("app.services.analysis_service.request_model", side_effect=model):
            result = await analyze_market(AnalysisRequest(settings=config(), scope="chart", ticker="AAPL", period="1d", interval="5m"), service)
        service.get_historical_data.assert_awaited_once_with("AAPL", "1d", "5m")
        self.assertEqual(result.context["bar_count"], 40)
        self.assertNotIn("api_key", result.model_dump_json())
        self.assertNotIn("secret-fixture", result.model_dump_json())

    async def test_missing_chart_data_does_not_call_model(self):
        service = self.service()
        service.get_historical_data.side_effect = OSError("offline")
        with patch("app.services.analysis_service.request_model") as model:
            with self.assertRaises(DataSourceUnavailable):
                await analyze_market(AnalysisRequest(settings=config(), scope="chart", ticker="AAPL"), service)
        model.assert_not_called()

    async def test_minute_candle_analysis_uses_the_same_ohlc_selection(self):
        service = self.service()
        def model(settings, system, evidence):
            self.assertEqual(evidence["interval"], "15m")
            self.assertEqual(evidence["price_type"], "ohlc")
            self.assertIn("open", evidence["bars"][0])
            return {"summary": "minute candle fixture", "annotations": [{"id": evidence["candidates"][0]["id"], "label": "支撑"}]}
        with patch("app.services.analysis_service.request_model", side_effect=model):
            await analyze_market(AnalysisRequest(settings=config(), scope="chart", ticker="AAPL", period="5d", interval="15m", chart_type="candles"), service)
        service.get_historical_data.assert_awaited_once_with("AAPL", "5d", "15m", candles=True)

    async def test_news_analysis_respects_current_filter(self):
        service = self.service()
        with patch("app.services.analysis_service.request_model", return_value={"summary": "news", "drivers": ["fact"]}):
            result = await analyze_market(AnalysisRequest(settings=config(), scope="news", query="economy", news_source="Fixture"), service)
        self.assertEqual(result.context["news_count"], 1)
        self.assertEqual(result.annotations, [])
        service.get_historical_data.assert_not_called()

    async def test_english_request_sets_model_output_language(self):
        def model(settings, system, evidence):
            self.assertIn("Return concise JSON in English", system)
            self.assertIn("All prose and annotation labels must be in English", system)
            self.assertEqual(evidence["scope"], "news")
            return {"summary": "Fixture analysis in English"}
        with patch("app.services.analysis_service.request_model", side_effect=model):
            result = await analyze_market(AnalysisRequest(settings=config(), scope="news", language="en"), self.service())
        self.assertEqual(result.summary, "Fixture analysis in English")


if __name__ == "__main__":
    unittest.main()
