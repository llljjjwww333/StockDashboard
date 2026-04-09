from fastapi import APIRouter, HTTPException, Query
from app.services.stock_data_service import StockDataService
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
stock_service = StockDataService()

@router.get("/stocks/{ticker}/history", response_model=StockHistoryResponse)
async def get_stock_history(ticker: str, period: str = Query("1y", description="Time period: 1d, 1wk, 1mo, 3mo, 1y"), interval: str = Query("1d", description="Interval: 1m, 5m, 15m, 30m, 1h, 1d, 1wk, 1mo")):
    """Get historical stock data for a given ticker"""
    try:
        history = await stock_service.get_historical_data(ticker, period, interval)
        return history
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
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Error fetching quote for {ticker}: {str(e)}")

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


@router.get("/news", response_model=FinanceNewsResponse)
async def get_finance_news(
    market: str = Query("ALL", description="Market type: ALL, US or CN"),
    limit: int = Query(200, ge=20, le=500, description="Number of news items to return"),
):
    """Get real-time hot financial news."""
    try:
        return await stock_service.get_finance_news(market, limit)
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
