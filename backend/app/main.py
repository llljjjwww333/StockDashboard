from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.ws.stock_updates import router as ws_router
from app.api.routes import router as api_router

app = FastAPI(
    title="FinSense Board API",
    description="Stock market dashboard API with real-time updates",
    version="1.0.0"
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(api_router, prefix="/api/v1")
app.include_router(ws_router, prefix="/ws")

@app.get("/")
async def root():
    return {"message": "FinSense Board API is running"}

@app.get("/health")
async def health_check():
    return {"status": "healthy"}
