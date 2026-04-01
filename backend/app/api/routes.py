from fastapi import APIRouter, HTTPException
from app.services.stock_data_service import StockDataService
from app.schemas.stock import StockHistoryResponse

router = APIRouter()
stock_service = StockDataService()

@router.get("/stocks/{ticker}/history", response_model=StockHistoryResponse)
async def get_stock_history(ticker: str):
    """Get historical stock data for a given ticker"""
    try:
        history = await stock_service.get_historical_data(ticker)
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
