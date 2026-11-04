"""Isolated localhost test harness. No real model, keys or market claims."""
import json
import os
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading
import time

from fastapi import FastAPI
from app.api import routes
from app.schemas.stock import FinanceNewsItem, FinanceNewsResponse, StockDataPoint, StockHistoryResponse, StockUpdate

os.environ["AI_ALLOW_LOCAL_PROVIDER"] = "1"
calls = []


class ModelHandler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        content = json.loads(payload["messages"][-1]["content"])
        protocol = "anthropic" if self.path.endswith("/messages") else "chat"
        key = self.headers.get("x-api-key") or self.headers.get("Authorization", "").removeprefix("Bearer ")
        if key != "fixture-secret-key":
            self.send_response(401)
            self.end_headers()
            self.wfile.write(b'{"error":"test authentication failure"}')
            return
        calls.append({"scope": content.get("scope", "test"), "period": content.get("period"),
                      "interval": content.get("interval"), "bar_count": len(content.get("bars", [])),
                      "news_count": len(content.get("news", [])), "model": payload["model"], "protocol": protocol})
        if payload["model"] == "slow-model":
            time.sleep(2)
        if content.get("scope"):
            candidates = content.get("candidates", [])
            points = [{"id": point["id"], "label": "关键支撑" if point["kind"] == "support" else "关键阻力", "detail": "依据当前周期真实候选位置生成的受控测试结果。"} for point in candidates[:2]]
            # Deliberately include an invented marker to exercise the server's rejection.
            points.append({"id": "invented-999", "price": 999999, "label": "INVALID"})
            result = {"summary": "受控测试：当前区间呈现震荡上行。", "outlook": "测试走势", "drivers": ["成交量与区间均线配合"], "watch": ["观察关键支撑位置"],
                      "annotations": points if content["scope"] == "chart" else []}
            system = payload.get("system", "") or next((m["content"] for m in payload["messages"] if m.get("role") == "system"), "")
            if "Return concise JSON in English" in system:
                result.update(summary="Controlled fixture: the selected period trends higher.", outlook="Test trend", drivers=["Volume and moving averages"], watch=["Watch key support"])
                for point in result["annotations"]:
                    if point["id"] != "invented-999":
                        point.update(label="Support", detail="Controlled fixture anchored to a supplied candle.")
            text = json.dumps(result, ensure_ascii=False)
        else:
            text = "OK"
        response = {"content": [{"type": "text", "text": text}]} if protocol == "anthropic" else {"choices": [{"message": {"content": text}}]}
        body = json.dumps(response, ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class FixtureService:
    def get_stock_market(self, ticker):
        return "CN" if ticker.isdigit() else "US"

    async def get_finance_news(self, market, limit):
        return FinanceNewsResponse(market="ALL", updated_at="2026-11-01T08:00:00Z", keywords=[], items=[
            FinanceNewsItem(title="利率与市场", summary="测试财经材料", source="测试来源", market="ALL", published_at="2026-11-01T08:00:00Z"),
            FinanceNewsItem(title="公司业绩", summary="测试公司材料", source="测试来源", market="ALL", published_at="2026-11-01T07:00:00Z"),
        ])

    async def get_market_hotspots(self, market):
        return {"summary": {"mode": "proxy"}, "indices": []}

    async def get_historical_data(self, ticker, period, interval):
        count = 40 if period == "1d" else 80
        start = datetime(2026, 10, 30, 13, 30, tzinfo=timezone.utc)
        step = timedelta(minutes=5) if period == "1d" else timedelta(days=1)
        points = [StockDataPoint(timestamp=(start + i * step).isoformat(), open=300 + i * .3,
                    close=300.2 + i * .3, high=301 + i * .3, low=299 + i * .3, volume=10000 + i * 100) for i in range(count)]
        return StockHistoryResponse(ticker=ticker, data=points, source="TEST FIXTURE")

    async def get_real_time_data(self, ticker):
        return StockUpdate(ticker=ticker, price=320, volume=10000, change_percent=1)


model_server = ThreadingHTTPServer(("127.0.0.1", 8769), ModelHandler)
threading.Thread(target=model_server.serve_forever, daemon=True).start()
routes.stock_service = FixtureService()
app = FastAPI()
app.include_router(routes.router, prefix="/api/v1")


@app.get("/test-calls")
async def test_calls():
    return calls


@app.on_event("shutdown")
async def shutdown():
    model_server.shutdown()
