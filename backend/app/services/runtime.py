"""One data service per worker, shared by HTTP and all WebSocket clients."""
from app.services.stock_data_service import StockDataService

stock_service = StockDataService()
