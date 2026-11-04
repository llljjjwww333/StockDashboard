import asyncio
from datetime import datetime, timezone
import io
import time
import unittest
from unittest.mock import patch

from app.schemas.stock import StockDataPoint, StockHistoryResponse, StockUpdate
from app.services.cn_market import ChinaBoardFeed
from app.services.stock_data_service import DataSourceUnavailable, StockDataService
from app.api.ws.stock_updates import ConnectionManager, refresh_interval


def quote(ticker="600519"):
    return StockUpdate(ticker=ticker, price=100, volume=1000, change_percent=1,
                       source="fixture", as_of="2026-10-30T15:00:00+08:00")


class MarketDataTests(unittest.IsolatedAsyncioTestCase):
    async def test_search_expands_beyond_static_us_directory(self):
        service = StockDataService()
        with patch.object(service, "_http_get_text", return_value='v_hint="us~amd.oq~Advanced Micro Devices~amd~GP"') as upstream:
            first = await service.search_stocks("AMD", "US")
            second = await service.search_stocks("AMD", "US")
        self.assertEqual(first, [{"ticker": "AMD", "name": "Advanced Micro Devices"}])
        self.assertEqual(first, second)
        self.assertEqual(upstream.call_count, 1)

    async def test_search_accepts_exchange_traded_funds(self):
        service = StockDataService()
        payload = {"QuotationCodeTable": {"Data": [{"Code": "510300", "Name": "沪深300ETF", "Classify": "Fund", "MktNum": "1"}]}}
        with patch.object(service, "_http_get_json", return_value=payload):
            self.assertEqual((await service.search_stocks("510300", "CN"))[0]["ticker"], "510300")

    async def test_non_exchange_funds_are_not_misrepresented_as_stocks(self):
        service = StockDataService()
        payload = {"QuotationCodeTable": {"Data": [{"Code": "000001", "Name": "NonTradedFund", "Classify": "Fund", "MktNum": "90"}]}}
        with patch.object(service, "_http_get_json", return_value=payload), patch.object(service, "_read_json_cache", return_value={}):
            self.assertEqual(await service.search_stocks("NonTradedFund", "CN"), [])

    async def test_related_stocks_remain_in_same_market(self):
        service = StockDataService()
        service.industry_map = {"AAPL": "Technology", "300033": "Technology", "300059": "Technology"}
        self.assertEqual(await service.get_recommendations("300033"), ["300059"])
        self.assertEqual(await service.get_recommendations("UNKNOWN"), [])

    async def test_empty_news_source_is_not_reported_as_success(self):
        service = StockDataService()
        with patch.object(service, "_http_get_json", return_value={"data": None}):
            with self.assertRaises(DataSourceUnavailable):
                service._fetch_news_source("eastmoney")

    async def test_all_news_sources_down_returns_error(self):
        service = StockDataService()
        with patch.object(service, "_fetch_news_source", side_effect=OSError("offline")):
            with self.assertRaises(DataSourceUnavailable):
                await service.get_finance_news()

    async def test_beijing_exchange_codes_are_not_sent_to_shanghai(self):
        service = StockDataService()
        self.assertEqual(service._get_cn_tencent_symbol("920992"), "bj920992")
        self.assertEqual(service._get_cn_tencent_symbol("830799"), "bj830799")
        self.assertEqual(service._get_cn_tencent_symbol("600519"), "sh600519")
        self.assertEqual(service._get_cn_tencent_symbol("300059"), "sz300059")

    async def test_shanghai_index_never_resolves_to_shenzhen_stock(self):
        service = StockDataService()
        self.assertEqual(service.get_stock_market("SH000001"), "CN")
        self.assertEqual(service._get_cn_tencent_symbol("SH000001"), "sh000001")
        self.assertEqual(service._get_cn_tencent_symbol("000001"), "sz000001")
        self.assertEqual(service._get_cn_eastmoney_secid("SH000001"), "1.000001")
        self.assertEqual(await service.search_stocks("上证指数", "CN"), [{"ticker": "SH000001", "name": "上证指数"}])

    async def test_board_pages_share_a_request_and_preserve_cached_values_on_failure(self):
        payload = {"data": {"total": 48, "diff": [
            {"f12": "BK1326", "f14": "半导体设备", "f2": 1200.2, "f3": -2.3, "f6": 89000, "f104": 4, "f105": 20, "f106": 0},
        ]}}
        feed = ChinaBoardFeed(lambda *_: payload)
        with patch.object(feed, "get_json", return_value=payload) as upstream:
            first, second = await asyncio.gather(feed.get(page=2), feed.get(page=2))
        self.assertEqual(upstream.call_count, 1)
        self.assertIs(first, second)
        self.assertEqual(first["rows"][0]["change_percent"], -2.3)
        self.assertEqual(first["page"], 2)
        feed.cache[("industry", "strong", 2, None)] = (time.monotonic() - 60, first)
        with patch.object(feed, "get_json", side_effect=OSError("offline")):
            result = await feed.get(page=2)
        self.assertTrue(result["stale"])
        self.assertEqual(result["rows"], first["rows"])

    async def test_stock_memberships_keep_primary_industry_and_multiple_boards(self):
        from urllib.parse import parse_qs, urlsplit
        def fetch(url, timeout):
            query = parse_qs(urlsplit(url).query)
            self.assertEqual(query["secid"], ["0.920117"])
            industry = {"f12": "BK0545", "f14": "通用设备"}
            boards = [{"f12": "BK1762", "f14": "高端装备"}, {"f12": "BK0968", "f14": "固态电池"}]
            rows = [industry, *boards, boards[0]] if query["spt"] == ["3"] else [{"f12": "920117", "f14": "龙鑫智能"}, industry]
            return {"data": {"diff": rows}}

        service = StockDataService()
        service.cn_boards = ChinaBoardFeed(fetch)
        result = await service.get_stock_memberships("920117")
        self.assertEqual(result["industry"], "通用设备")
        self.assertEqual(result["boards"], ["高端装备", "固态电池"])

    async def test_board_search_checks_later_pages_and_reuses_catalog_across_queries(self):
        from urllib.parse import parse_qs, urlsplit
        def fetch(url, timeout):
            query = parse_qs(urlsplit(url).query)
            self.assertEqual(query["fid"], ["f12"])
            page = int(query["pn"][0])
            rows = [{"f12": f"BK{number:04}", "f14": "航空制造" if number == 103 else "其他行业",
                     "f2": 100, "f3": 1, "f6": 200}
                    for number in range((page - 1) * 100 + 1, min(page * 100, 104) + 1)]
            return {"data": {"total": 104, "diff": rows}}

        feed = ChinaBoardFeed(fetch)
        with patch.object(feed, "get_json", side_effect=fetch) as upstream:
            by_name = await feed.search("industry", "amount", 1, "航空")
            by_code = await feed.search("industry", "weak", 1, "ＢＫ０１０３")
            self.assertEqual(upstream.call_count, 2)
        self.assertEqual(by_name["total"], 1)
        self.assertEqual(by_name["rows"][0]["ticker"], "BK0103")
        self.assertEqual(by_code["rows"], by_name["rows"])

    def test_breadth_excludes_zero_quotes_and_recovers_missing_change(self):
        service = StockDataService()
        self.assertIsNone(service._build_cn_hotspot_row("600519", "贵州茅台", {"price": 0, "previous_close": 100}))
        row = service._build_cn_hotspot_row("600519", "贵州茅台", {"price": 104, "previous_close": 100})
        self.assertEqual(row["change_percent"], 4.0)

    async def test_history_failure_never_generates_prices(self):
        service = StockDataService()
        with patch.object(service, "_fetch_cn_daily_fast", side_effect=OSError("offline")):
            with self.assertRaises(DataSourceUnavailable):
                await service.get_historical_data("600519")
        self.assertEqual(service.history_cache, {})

    async def test_history_failure_preserves_real_cache_timestamp(self):
        service = StockDataService()
        real = StockHistoryResponse(ticker="600519", source="fixture", fetched_at="2026-10-30T07:00:00Z", data=[
            StockDataPoint(timestamp="2026-10-30T15:00:00+08:00", open=99, high=101, low=98, close=100, volume=1000),
        ])
        service.history_cache["600519:1mo:1d"] = (time.time() - 300, real)
        with patch.object(service, "_fetch_cn_daily_fast", side_effect=OSError("offline")):
            result = await service.get_historical_data("600519")
            await asyncio.gather(*list(service.history_refresh_tasks.values()))
        self.assertTrue(result.stale)
        self.assertEqual(result.fetched_at, real.fetched_at)
        self.assertEqual(result.data, real.data)

    async def test_concurrent_quotes_share_one_upstream_request(self):
        service = StockDataService()
        def fetch(tickers):
            time.sleep(0.02)
            return {ticker: quote(ticker) for ticker in tickers}
        with patch.object(service, "_fetch_batch_quotes", side_effect=fetch) as upstream:
            results = await asyncio.gather(*(service.get_real_time_data("600519") for _ in range(15)))
        self.assertEqual(upstream.call_count, 1)
        self.assertTrue(all(result.price == 100 for result in results))

    async def test_partial_batch_does_not_invent_missing_quote(self):
        service = StockDataService()
        with patch.object(service, "_fetch_batch_quotes", return_value={"600519": quote()}):
            result = await service.get_quote_batch(["600519", "000001"])
        self.assertEqual(set(result), {"600519"})

    async def test_quote_outage_marks_cache_stale_and_rejects_expired(self):
        service = StockDataService()
        service.quote_cache["600519"] = (time.time() - 60, quote())
        with patch.object(service, "_fetch_batch_quotes", side_effect=OSError("offline")):
            result = await service.get_real_time_data("600519")
            self.assertTrue(result.stale)
            self.assertEqual(result.as_of, quote().as_of)
            service.quote_cache["600519"] = (time.time() - 7200, quote())
            with self.assertRaises(DataSourceUnavailable):
                await service.get_real_time_data("600519")

    async def test_invalid_tickers_rejected_before_network(self):
        service = StockDataService()
        with patch.object(service, "_fetch_batch_quotes") as upstream:
            with self.assertRaises(ValueError):
                await service.get_quote_batch(["AAPL&other=value"])
            with self.assertRaises(ValueError):
                await service.get_quote_batch([str(index) for index in range(101)])
        upstream.assert_not_called()

    async def test_unsubscribe_and_disconnect_remove_unused_tickers(self):
        manager = ConnectionManager()
        first, second = object(), object()
        await manager.subscribe(first, "AAPL")
        await manager.subscribe(second, "AAPL")
        await manager.unsubscribe(first, "AAPL")
        self.assertEqual(manager.subscriptions["AAPL"], [second])
        manager.disconnect(second)
        self.assertEqual(manager.subscriptions, {})

    async def test_refresh_policy_uses_market_timezone(self):
        class Clock:
            @staticmethod
            def now(zone):
                return datetime(2026, 11, 2, 10, 0, tzinfo=zone)
        with patch("app.api.ws.stock_updates.datetime", Clock):
            self.assertEqual(refresh_interval(["600519"]), 2.0)
            self.assertEqual(refresh_interval(["AAPL"]), 2.0)
        class Weekend:
            @staticmethod
            def now(zone):
                return datetime(2026, 11, 1, 10, 0, tzinfo=zone)
        with patch("app.api.ws.stock_updates.datetime", Weekend):
            self.assertEqual(refresh_interval(["600519", "AAPL"]), 30.0)

    async def test_batch_parser_preserves_market_volume_units_and_timezones(self):
        def line(symbol, ticker, timestamp):
            fields = ["0"] * 39
            for index, value in {1: "Test", 2: ticker, 3: "100", 4: "99", 5: "98", 6: "123", 30: timestamp, 33: "101", 34: "97", 37: "456", 38: "1.2"}.items():
                fields[index] = value
            return f'v_{symbol}="' + "~".join(fields) + '";'
        body = (line("sh600519", "600519", "20261030150000") +
                line("usAAPL", "AAPL.OQ", "2026-10-30 16:00:02")).encode("gbk")
        with patch("urllib.request.urlopen", return_value=io.BytesIO(body)):
            result = StockDataService()._fetch_batch_quotes(["600519", "AAPL"])
        self.assertEqual(result["600519"].volume, 12300)
        self.assertEqual(result["AAPL"].volume, 123)
        self.assertEqual(result["600519"].amount, 4560000)
        self.assertEqual(result["AAPL"].amount, 456)
        self.assertTrue(result["600519"].as_of.endswith("+08:00"))
        self.assertTrue(result["AAPL"].as_of.endswith("-04:00"))

    async def test_extended_metrics_follow_market_specific_tencent_layout(self):
        def line(symbol, ticker, timestamp, values):
            fields = [""] * 54
            for index, value in {2: ticker, 3: "100", 4: "99", 5: "98", 6: "123", 30: timestamp, 33: "101", 34: "97", **values}.items():
                fields[index] = value
            return f'v_{symbol}="' + "~".join(fields) + '";'
        body = (line("sh600519", "600519", "20261030150000", {39: "21.18", 45: "17401.76", 46: "6.42", 49: "1.36"}) +
                line("usAAPL", "AAPL.OQ", "2026-10-30 16:00:02", {39: "39.52", 45: "50295.92253", 46: "Apple Inc.", 49: "242.76", 51: "46.78"})).encode("gbk")
        with patch("urllib.request.urlopen", return_value=io.BytesIO(body)):
            result = StockDataService()._fetch_batch_quotes(["600519", "AAPL"])
        self.assertEqual(result["600519"].volume_ratio, 1.36)
        self.assertEqual(result["600519"].pe_ratio, 21.18)
        self.assertEqual(result["600519"].pb_ratio, 6.42)
        self.assertEqual(result["600519"].market_cap, 1740176000000)
        self.assertIsNone(result["AAPL"].volume_ratio)  # US index 49 is a price, never a ratio.
        self.assertEqual(result["AAPL"].pe_ratio, 39.52)
        self.assertIsNone(result["AAPL"].pb_ratio)
        self.assertEqual(result["AAPL"].market_cap, 5029592253000)

    async def test_optional_valuation_fields_preserve_missing_and_negative_pe(self):
        service = StockDataService()
        self.assertTrue(all(value is None for value in service._tencent_quote_metrics([""] * 39, "CN").values()))
        fields = [""] * 54
        fields[39], fields[46], fields[49] = "-12.34", "0", "0.00"
        metrics = service._tencent_quote_metrics(fields, "CN")
        self.assertEqual(metrics["pe_ratio"], -12.34)
        self.assertEqual(metrics["volume_ratio"], 0)
        self.assertIsNone(metrics["pb_ratio"])
        self.assertIsNone(metrics["market_cap"])
        fields[39], fields[45], fields[49] = "Infinity", "Infinity", "NaN"
        self.assertTrue(all(value is None for value in service._tencent_quote_metrics(fields, "CN").values()))

    async def test_single_cn_quote_carries_extended_metrics(self):
        service = StockDataService()
        with patch.object(service, "_fetch_cn_quote_snapshot_map", return_value={"600519": {
            "price": 100, "previous_close": 99, "volume_lots": 10,
            "volume_ratio": 1.36, "pe_ratio": 21.18, "pb_ratio": 6.42, "market_cap": 1000000,
        }}):
            result = service._fetch_cn_quote("600519")
        self.assertEqual(result.volume_ratio, 1.36)
        self.assertEqual(result.pe_ratio, 21.18)


if __name__ == "__main__":
    unittest.main()
