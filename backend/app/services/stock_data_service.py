import random
from datetime import datetime, timedelta
from typing import List, Dict, Any
from app.schemas.stock import StockHistoryResponse, StockDataPoint, StockUpdate

class StockDataService:
    def __init__(self):
        # Mock industry data for recommendations
        self.industry_map = {
            "AAPL": "Technology",
            "MSFT": "Technology",
            "GOOGL": "Technology",
            "AMZN": "Consumer Cyclical",
            "META": "Technology",
            "TSLA": "Consumer Cyclical",
            "JPM": "Financial Services",
            "V": "Financial Services",
            "JNJ": "Healthcare",
            "PFE": "Healthcare",
        }
        
        # Mock stock prices for initialization
        self.base_prices = {
            "AAPL": 180.0,
            "MSFT": 400.0,
            "GOOGL": 130.0,
            "AMZN": 170.0,
            "META": 300.0,
            "TSLA": 250.0,
            "JPM": 150.0,
            "V": 240.0,
            "JNJ": 160.0,
            "PFE": 40.0,
        }
    
    async def get_historical_data(self, ticker: str) -> StockHistoryResponse:
        """Generate mock historical stock data"""
        # Check if ticker exists in our mock data
        if ticker not in self.base_prices:
            # Generate a random base price if ticker is not in our list
            base_price = random.uniform(50, 500)
        else:
            base_price = self.base_prices[ticker]
        
        # Generate 365 days of mock data
        data = []
        end_date = datetime.now()
        start_date = end_date - timedelta(days=365)
        
        current_date = start_date
        current_price = base_price
        
        while current_date <= end_date:
            # Generate random price variations
            change = random.uniform(-2, 2)
            current_price = max(1, current_price + change)
            
            # Generate OHLC data
            open_price = current_price
            high = current_price + random.uniform(0, 1)
            low = current_price - random.uniform(0, 1)
            close = current_price + random.uniform(-0.5, 0.5)
            volume = random.randint(1000000, 10000000)
            
            data_point = StockDataPoint(
                timestamp=current_date.isoformat(),
                open=round(open_price, 2),
                high=round(high, 2),
                low=round(low, 2),
                close=round(close, 2),
                volume=volume
            )
            
            data.append(data_point)
            current_date += timedelta(days=1)
        
        return StockHistoryResponse(ticker=ticker, data=data)
    
    async def get_recommendations(self, ticker: str) -> List[str]:
        """Get related stock recommendations based on industry"""
        # Get industry for the given ticker
        industry = self.industry_map.get(ticker, "Technology")
        
        # Find other stocks in the same industry
        recommendations = [
            stock for stock, stock_industry in self.industry_map.items() 
            if stock_industry == industry and stock != ticker
        ]
        
        # Return up to 5 recommendations
        return recommendations[:5]
    
    async def get_real_time_data(self, ticker: str) -> StockUpdate:
        """Generate mock real-time stock data"""
        # Get base price or generate a random one
        if ticker not in self.base_prices:
            base_price = random.uniform(50, 500)
            self.base_prices[ticker] = base_price
        else:
            base_price = self.base_prices[ticker]
        
        # Generate random price change
        change_percent = random.uniform(-2, 2)
        price_change = base_price * (change_percent / 100)
        new_price = base_price + price_change
        
        # Update the base price for next call
        self.base_prices[ticker] = new_price
        
        return StockUpdate(
            ticker=ticker,
            price=round(new_price, 2),
            volume=random.randint(100000, 1000000),
            change_percent=round(change_percent, 2)
        )
