"""Verify that two real WebSocket clients receive shared source snapshots."""
import asyncio
from datetime import datetime, timezone
import json
from pathlib import Path
import time
import websockets


async def consume():
    observations = []
    async with websockets.connect("ws://127.0.0.1:8000/ws/stock-updates") as socket:
        for ticker in ("AAPL", "NVDA", "600519", "300059"):
            await socket.send(json.dumps({"type": "subscribe", "data": {"ticker": ticker}}))
        deadline = time.monotonic() + 36
        while time.monotonic() < deadline:
            try:
                message = json.loads(await asyncio.wait_for(socket.recv(), max(0.1, deadline - time.monotonic())))
            except asyncio.TimeoutError:
                break
            if message.get("type") == "update":
                quote = message["data"]
                assert quote["source"] and quote["as_of"] and quote["fetched_at"]
                observations.append({"ticker": quote["ticker"], "fetched_at": quote["fetched_at"], "as_of": quote["as_of"], "received": time.monotonic()})
    return observations


async def main():
    clients = await asyncio.gather(consume(), consume())
    timestamps = []
    for observations in clients:
        assert {item["ticker"] for item in observations} == {"AAPL", "NVDA", "600519", "300059"}
        fetched = {item["fetched_at"] for item in observations if item["ticker"] == "AAPL"}
        assert len(fetched) >= 2, "Expected a second source refresh within 36 seconds"
        timestamps.append(fetched)
    shared = sorted(timestamps[0] & timestamps[1])
    assert len(shared) >= 2, "Clients should receive the same source refreshes"
    report = {"checked_at": datetime.now(timezone.utc).isoformat(), "clients": 2,
              "duration_seconds": 36, "messages": [len(client) for client in clients],
              "shared_fetch_timestamps": shared, "same_source_snapshots": True,
              "scope": "Weekend shared delivery, not exchange tick latency"}
    Path("reports/stream-check.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
