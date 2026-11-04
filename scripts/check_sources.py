"""Read-only endpoint probes; keep failures visible and never use simulated data."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
from pathlib import Path
import time
import urllib.error
import urllib.request


TARGETS = {
    "yahoo_chart": "https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=5d&interval=1d",
    "yahoo_chart_secondary": "https://query2.finance.yahoo.com/v8/finance/chart/AAPL?range=5d&interval=1d",
    "yahoo_screener": "https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=day_gainers&count=5",
    "tencent_quote": "https://qt.gtimg.cn/q=sh600519",
    "tencent_us_quote": "https://qt.gtimg.cn/q=usAAPL,usNVDA,usTSLA",
    "tencent_us_history": "https://web.ifzq.gtimg.cn/appstock/app/usfqkline/get?param=usAAPL.OQ,day,,,80,qfq",
    "tencent_history": "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh600519,day,,,30,qfq",
    "sina_intraday": "https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=sh600519&scale=5&ma=no&datalen=80",
    "eastmoney_search": "https://searchapi.eastmoney.com/api/suggest/get?input=600519&type=14&count=3",
    "eastmoney_news": "https://np-weblist.eastmoney.com/comm/web/getFastNewsList?client=web&biz=web_724&fastColumn=102&sortEnd=0&pageSize=30&req_trace=1710315450384",
    "sina_news": "https://zhibo.sina.com.cn/api/zhibo/feed?page=1&page_size=20&zhibo_id=152&tag_id=0&dire=f&dpc=1&pagesize=20&type=1",
}


def summarize(name: str, body: bytes) -> dict:
    if name in {"tencent_quote", "tencent_us_quote"}:
        fields = body.decode("gbk").split('"')[1].split("~")
        if len(fields) < 32 or float(fields[3]) <= 0:
            raise ValueError("Invalid Tencent quote")
        return {"ticker": fields[2], "price": float(fields[3]), "market_timestamp": fields[30]}
    payload = json.loads(body)
    if name == "tencent_us_history":
        series = payload["data"]["usAAPL.OQ"]
        rows = series.get("qfqday") or series.get("day") or []
        if len(rows) < 2:
            raise ValueError("Empty US history")
        return {"points": len(rows), "last_date": rows[-1][0], "source_flag": series.get("qt", {}).get("usAAPL.OQ", [None])[0]}
    if name == "eastmoney_news":
        rows = payload["data"]["fastNewsList"]
        if not rows:
            raise ValueError("Empty news")
        return {"items": len(rows)}
    if name == "sina_news":
        rows = payload["result"]["data"]["feed"]["list"]
        if not rows:
            raise ValueError("Empty news")
        return {"items": len(rows)}
    if name.startswith("yahoo_chart"):
        result = payload["chart"]["result"][0]
        return {"points": len(result["timestamp"]), "market_timestamp": result["meta"].get("regularMarketTime")}
    if name == "tencent_history":
        data = payload["data"]["sh600519"]
        rows = data.get("qfqday") or data.get("day") or []
        if not rows:
            raise ValueError("Empty Tencent history")
        return {"points": len(rows), "last_date": rows[-1][0]}
    if name == "sina_intraday":
        if not isinstance(payload, list) or not payload:
            raise ValueError("Empty Sina history")
        return {"points": len(payload), "last_date": payload[-1]["day"]}
    if name == "yahoo_screener":
        return {"rows": len(payload["finance"]["result"][0]["quotes"])}
    if name == "eastmoney_search":
        return {"rows": len(payload["QuotationCodeTable"]["Data"])}
    if isinstance(payload, dict):
        details = {key: payload[key] for key in ("status", "ticker", "source", "stale", "as_of", "updated_at", "market") if key in payload}
        for key in ("data", "items", "results", "indices", "leaders"):
            if isinstance(payload.get(key), list):
                details[key + "_count"] = len(payload[key])
                if key in {"data", "items"} and not payload[key]:
                    raise ValueError(f"Empty {key} returned with HTTP 200")
        if "summary" in payload:
            details["mode"] = payload["summary"].get("mode")
        return details
    return {"type": type(payload).__name__}


def probe(item: tuple[str, str], timeout: float) -> dict:
    name, url = item
    started = time.monotonic()
    result = {"name": name, "url": url}
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read()
            result.update(status=response.status, bytes=len(body), details=summarize(name, body), ok=True)
    except urllib.error.HTTPError as exc:
        result.update(ok=False, status=exc.code, error=str(exc))
    except Exception as exc:
        result.update(ok=False, error=f"{type(exc).__name__}: {exc}")
    result["seconds"] = round(time.monotonic() - started, 3)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", help="Also check the running backend, e.g. http://127.0.0.1:8000")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--timeout", type=float, default=18)
    args = parser.parse_args()
    targets = dict(TARGETS)
    if args.api:
        for name, path in {
            "api_health": "/health",
            "api_us_quote": "/api/v1/stocks/AAPL/quote",
            "api_cn_quote": "/api/v1/stocks/600519/quote",
            "api_us_history": "/api/v1/stocks/AAPL/history?period=1mo&interval=1d",
            "api_cn_history": "/api/v1/stocks/600519/history?period=1mo&interval=1d",
            "api_cn_intraday": "/api/v1/stocks/600519/history?period=1d&interval=5m",
            "api_search": "/api/v1/stocks/search?query=600519&market=CN",
            "api_news": "/api/v1/news?market=ALL&limit=20",
            "api_us_hotspots": "/api/v1/market/hotspots?market=US",
            "api_cn_hotspots": "/api/v1/market/hotspots?market=CN",
        }.items():
            targets[name] = args.api.rstrip("/") + path
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(lambda item: probe(item, args.timeout), targets.items()))
    report = {"checked_at": datetime.now(timezone.utc).isoformat(), "results": results}
    output = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output + "\n", encoding="utf-8")
    print(output)


if __name__ == "__main__":
    main()
