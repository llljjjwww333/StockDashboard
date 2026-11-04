from fastapi import APIRouter, HTTPException, Query
from app.services.runtime import stock_service
from app.services.cn_market import CN_INDICES
from app.services.stock_data_service import DataSourceUnavailable
from app.schemas.analysis import AnalysisRequest, MarketAnalysis, ProviderTestRequest
from app.services.analysis_service import analyze_market, request_model, ProviderError
import asyncio
from typing import Literal
from app.schemas.stock import (
    AiContextAnalysisRequest,
    AiContextAnalysisResponse,
    FinanceNewsAiRequest,
    FinanceNewsAiResponse,
    FinanceNewsResponse,
    StockHistoryResponse,
    StockUpdate,
)

router = APIRouter()


@router.post("/ai/providers/test")
async def test_ai_provider(payload: ProviderTestRequest):
    try:
        return await asyncio.wait_for(asyncio.to_thread(request_model, payload.settings,
            "Reply with OK.", {"message": "Connection test"}, True), timeout=60)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    except (ProviderError, asyncio.TimeoutError) as exc:
        raise HTTPException(502, str(exc) or "模型响应超时") from None


@router.post("/ai/analyze", response_model=MarketAnalysis)
async def analyze_current_market(payload: AnalysisRequest):
    try:
        return await analyze_market(payload, stock_service)
    except DataSourceUnavailable as exc:
        raise HTTPException(503, str(exc)) from None
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    except ProviderError as exc:
        raise HTTPException(502, str(exc)) from None

@router.get("/stocks/{ticker}/history", response_model=StockHistoryResponse)
async def get_stock_history(ticker: str, period: str = Query("1y", description="Time period: 1d, 5d, 1mo, 3mo, 1y; legacy 1wk aliases 5d"), interval: str = Query("1d", description="Interval: 1m, 5m, 15m, 30m, 1h, 1d, 1wk, 1mo"), candles: bool = Query(False, description="Request genuine minute OHLC candles instead of price snapshots")):
    """Get historical stock data for a given ticker"""
    try:
        history = await stock_service.get_historical_data(ticker, period, interval, candles=candles)
        return history
    except DataSourceUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Error fetching data for {ticker}: {str(e)}")

@router.get("/stocks/{ticker}/recommendations")
async def get_stock_recommendations(ticker: str):
    """Get related stock recommendations for a given ticker"""
    try:
        recommendations = await stock_service.get_recommendations(ticker)
        return {"recommendations": recommendations}
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Error fetching recommendations for {ticker}: {str(e)}")

@router.get("/stocks/{ticker}/quote", response_model=StockUpdate)
async def get_stock_quote(ticker: str):
    """Get the latest quote for a given ticker"""
    try:
        return await stock_service.get_real_time_data(ticker)
    except DataSourceUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/market/quotes")
async def get_batch_quotes(tickers: str = Query(..., max_length=2100)):
    try:
        requested = [ticker.strip().upper() for ticker in tickers.split(",") if ticker.strip()]
        quotes = await stock_service.get_quote_batch(requested)
        return {"quotes": [quote.model_dump() for quote in quotes.values()],
                "unavailable": [ticker for ticker in requested if ticker not in quotes]}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.get("/stocks/{ticker}/tags")
async def get_stock_tags(ticker: str):
    try:
        return await stock_service.get_stock_memberships(ticker)
    except (ValueError, OSError):
        raise HTTPException(503, "股票板块暂不可用") from None

@router.get("/stocks/search")
async def search_stocks(query: str = Query(..., description="Search query for stocks"), market: str = Query("US", description="Market type: US or CN")):
    """Search for stocks by ticker or name"""
    try:
        results = await stock_service.search_stocks(query, market)
        return {"results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error searching stocks: {str(e)}")

@router.get("/market/hotspots")
async def get_market_hotspots(
    market: str = Query("US", description="Market type: US or CN")
):
    """Get market-wide hotspot data for a representative universe."""
    try:
        return await stock_service.get_market_hotspots(market)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching market hotspots: {str(e)}")


@router.get("/market/cn/indices")
async def get_cn_indices():
    quotes = await stock_service.get_quote_batch(list(CN_INDICES))
    if not quotes:
        raise HTTPException(503, "指数行情暂不可用")
    return {"rows": [{**quotes[ticker].model_dump(), "name": name}
                     for ticker, name in CN_INDICES.items() if ticker in quotes],
            "stale": any(quote.stale for quote in quotes.values())}


@router.get("/market/cn/boards")
async def get_cn_boards(
    category: Literal["industry", "concept"] = "industry",
    sort: Literal["strong", "weak", "amount"] = "strong",
    page: int = Query(1, ge=1, le=100),
    query: str = Query("", max_length=40),
):
    try:
        if query.strip():
            return await stock_service.cn_boards.search(category, sort, page, query.strip())
        return await stock_service.cn_boards.get(category, sort, page)
    except (ValueError, OSError):
        raise HTTPException(503, "板块行情暂不可用") from None


@router.get("/market/cn/boards/{board}/members")
async def get_cn_board_members(board: str, page: int = Query(1, ge=1, le=100)):
    if len(board) != 6 or not board.startswith("BK") or not board[2:].isascii() or not board[2:].isdigit():
        raise HTTPException(400, "无效板块代码")
    try:
        return await stock_service.cn_boards.get(page=page, board=board)
    except (ValueError, OSError):
        raise HTTPException(503, "成分股暂不可用") from None


@router.get("/news", response_model=FinanceNewsResponse)
async def get_finance_news(
    market: str = Query("ALL", description="Market type: ALL, US or CN"),
    limit: int = Query(200, ge=20, le=500, description="Number of news items to return"),
):
    """Get real-time hot financial news."""
    try:
        return await stock_service.get_finance_news(market, limit)
    except DataSourceUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching financial news: {str(e)}")


@router.post("/news/ai-insights", response_model=FinanceNewsAiResponse)
async def get_finance_news_ai_insights(payload: FinanceNewsAiRequest):
    """Analyze financial news with a user-configured AI provider."""
    try:
        return await stock_service.get_finance_news_ai_insights(payload)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error analyzing financial news: {str(e)}")


@router.post("/ai/context-insights", response_model=AiContextAnalysisResponse)
async def get_ai_context_insights(payload: AiContextAnalysisRequest):
    """Analyze dashboard or hotspot context with a user-configured AI provider."""
    try:
        return await stock_service.get_ai_context_analysis(payload)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error analyzing AI context: {str(e)}")
