from fastapi import APIRouter, HTTPException, Query
from app.services.stock_data_service import StockDataService
from app.schemas.stock import StockHistoryResponse, StockUpdate

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
