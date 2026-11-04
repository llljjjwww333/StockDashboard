"""Measure real history delivery, stale-cache response and preview compression."""
import gzip
import json
from pathlib import Path
import re
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def read(url):
    start = time.perf_counter()
    with opener.open(urllib.request.Request(url, headers={"Accept-Encoding": "gzip"}), timeout=20) as response:
        wire = response.read()
        headers = {key.lower(): value for key, value in response.headers.items()}
    data = gzip.decompress(wire) if headers.get("content-encoding") == "gzip" else wire
    return data, {"seconds": round(time.perf_counter() - start, 4), "wire_bytes": len(wire),
                  "raw_bytes": len(data), "encoding": headers.get("content-encoding"),
                  "cache_control": headers.get("cache-control")}


checks = []
for ticker, period in [("600519", "1d"), ("600519", "1mo"), ("920117", "1d"), ("920117", "1mo"), ("AAPL", "1d")]:
    data, timing = read(f"http://127.0.0.1:8000/api/v1/stocks/{ticker}/history?period={period}")
    history = json.loads(data)
    checks.append({"ticker": ticker, "period": period, **timing, "points": len(history["data"]),
                   "source": history["source"], "stale": history["stale"]})
    if ticker == "920117" and period == "1mo":
        assert len(history["data"]) > 1, "Beijing daily source remains truncated"

target = "http://127.0.0.1:8000/api/v1/stocks/600519/history?period=1d"
time.sleep(11)
data, timing = read(target)
stale = json.loads(data)
assert stale["stale"] and timing["seconds"] < .5
time.sleep(2)
updated, update_timing = read(target)
fresh = json.loads(updated)
assert not fresh["stale"] and fresh["fetched_at"] != stale["fetched_at"]

html, html_timing = read("http://127.0.0.1:5175/")
asset_path = re.search(r'src="([^"]+\.js)"', html.decode()).group(1)
_, asset_timing = read("http://127.0.0.1:5175" + asset_path)
_, history_timing = read("http://127.0.0.1:5175/api/v1/stocks/AAPL/history?period=1d")
assert html_timing["cache_control"] == "no-store"
assert "immutable" in asset_timing["cache_control"]
assert asset_timing["encoding"] == history_timing["encoding"] == "gzip"
result = {"checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "api": checks,
          "expired_cache": {**timing, "stale": stale["stale"]},
          "background_refresh": {**update_timing, "stale": fresh["stale"], "fetched_at_changed": True},
          "preview_html": html_timing, "preview_asset": asset_timing, "preview_history": history_timing}
(ROOT / "reports/loading-live-check.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(result, ensure_ascii=False, indent=2))
