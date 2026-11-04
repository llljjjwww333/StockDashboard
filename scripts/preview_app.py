"""Built frontend, market reads, explicit AI requests and quote WebSocket preview."""
import asyncio
from contextlib import suppress
from pathlib import Path
import urllib.error
import urllib.request

from fastapi import FastAPI, Request, WebSocket
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.gzip import GZipMiddleware
import websockets

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(GZipMiddleware, minimum_size=1000, compresslevel=4)
dist = Path(__file__).resolve().parents[1] / "frontend" / "dist"


@app.middleware("http")
async def fresh_frontend_html(request: Request, call_next):
    response = await call_next(request)
    if response.headers.get("content-type", "").startswith("text/html"):
        response.headers["Cache-Control"] = "no-store"
    elif request.url.path.startswith('/assets/') and response.status_code == 200:
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return response


@app.get("/api/v1/{path:path}")
async def market_get(path: str, request: Request):
    if not (path.startswith("stocks/") or path.startswith("market/") or path == "news"):
        return Response(status_code=404)
    query = request.url.query
    url = "http://127.0.0.1:8000/api/v1/" + path + ("?" + query if query else "")

    def fetch():
        try:
            with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(url, timeout=25) as result:
                return Response(result.read(), status_code=result.status,
                                media_type="application/json", headers={"Cache-Control": "no-store"})
        except urllib.error.HTTPError as exc:
            return Response(exc.read(), status_code=exc.code, media_type="application/json")
        except OSError:
            return Response('{"detail":"Market unavailable"}', status_code=503, media_type="application/json")
    return await asyncio.to_thread(fetch)


@app.websocket("/ws/stock-updates")
async def quote_socket(client: WebSocket):
    await client.accept()
    try:
        async with websockets.connect("ws://127.0.0.1:8000/ws/stock-updates", max_size=65536) as upstream:
            async def upload():
                while True:
                    await upstream.send(await client.receive_text())

            async def download():
                async for message in upstream:
                    await client.send_text(message)

            tasks = [asyncio.create_task(upload()), asyncio.create_task(download())]
            try:
                await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            finally:
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
    except Exception:
        with suppress(Exception):
            await client.close()


@app.post("/api/v1/ai/{path:path}")
async def ai_post(path: str, request: Request):
    if path not in {"analyze", "providers/test"}:
        return Response(status_code=404)
    body = await request.body()
    if len(body) > 32768:
        return Response(status_code=413)
    def forward():
        upstream = urllib.request.Request("http://127.0.0.1:8000/api/v1/ai/" + path,
            data=body, headers={"Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(upstream, timeout=90) as result:
                return Response(result.read(), status_code=result.status, media_type="application/json",
                                headers={"Cache-Control": "no-store"})
        except urllib.error.HTTPError as exc:
            return Response(exc.read(), status_code=exc.code, media_type="application/json",
                            headers={"Cache-Control": "no-store"})
        except OSError:
            return Response('{"detail":"分析服务暂不可用"}', status_code=503, media_type="application/json")
    return await asyncio.to_thread(forward)


app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
