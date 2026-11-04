"""Verify genuine minute candles from live CN and US sources via the running API."""
import json
from pathlib import Path
import time
import urllib.request

root = Path(__file__).resolve().parents[1]
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
results = []
for ticker in ["600519", "AAPL"]:
    for interval in ["1m", "5m", "15m", "30m", "1h", "1d"]:
        period = "1mo" if interval == "1d" else "1d"
        url = f"http://127.0.0.1:8000/api/v1/stocks/{ticker}/history?period={period}&interval={interval}&candles=true"
        started = time.monotonic()
        with opener.open(url, timeout=20) as response:
            data = json.load(response)
        assert data["price_type"] == "ohlc" and data["interval"] == interval
        assert data["data"] and all(p["high"] >= max(p["open"], p["close"]) >= p["low"] for p in data["data"])
        results.append({"ticker": ticker, "period": period, "interval": interval, "source": data["source"],
            "points": len(data["data"]), "price_type": data["price_type"],
            "seconds": round(time.monotonic() - started, 3), "last_bar": data["data"][-1]})
    with opener.open(f"http://127.0.0.1:8000/api/v1/stocks/{ticker}/history?period=5d&interval=5m&candles=true", timeout=20) as response:
        data = json.load(response)
    dates = sorted({p["timestamp"][:10] for p in data["data"]})
    assert len(dates) == 5 and data["price_type"] == "ohlc"
    results.append({"ticker": ticker, "period": "5d", "interval": "5m", "source": data["source"], "points": len(data["data"]), "sessions": len(dates)})
report = {"checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "results": results}
(root / "reports/minute-candles-live-check.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(report, ensure_ascii=False, indent=2))
