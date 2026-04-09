# Stock Dashboard

![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.104-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-19-20232A?logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-7-DC382D?logo=redis&logoColor=white)
![Docker Compose](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)
![WebSocket](https://img.shields.io/badge/Realtime-WebSocket-4B8BBE)

一套面向美股和 A 股场景的实时股票看板，采用前后端分离的 Monorepo 结构：`FastAPI + React + TypeScript + Redis`。

项目目前覆盖了：
- 自选股列表与实时行情展示
- K 线 / 分时图查看
- 市场热点与板块热力图
- 财经新闻聚合
- 可配置 AI 新闻洞察与行情上下文分析
- WebSocket 实时订阅更新

## Preview

<p align="center">
  <img src="./frontend/public/zpboard.png" alt="Stock Dashboard logo" width="180" />
</p>

## Features

- 实时行情：通过 WebSocket 推送股票价格、涨跌幅和成交量更新。
- 多市场支持：同时支持 `US` 和 `CN` 市场查询与热点视图。
- 热点页：内置市场广度、热点板块、领涨领跌榜和可读性优化后的热力图。
- 图表分析：支持不同周期和分辨率切换的股票历史走势。
- 财经新闻：按市场聚合新闻流，并支持 AI 摘要与关键词提炼。
- AI 扩展：支持在前端配置 AI 提供商，用于新闻洞察和 dashboard / hotspot 上下文分析。
- Docker 部署：仓库已提供 `docker-compose.yml`，适合本地联调和容器化运行。

## Tech Stack

### Frontend

- React 19
- TypeScript
- Vite
- Zustand
- ApexCharts
- Tailwind CSS

### Backend

- FastAPI
- Pydantic
- Uvicorn
- Redis
- yfinance
- AkShare

## Project Structure

```text
.
├─ backend/
│  ├─ app/
│  │  ├─ api/
│  │  ├─ schemas/
│  │  ├─ services/
│  │  └─ main.py
│  ├─ requirements.txt
│  └─ Dockerfile
├─ frontend/
│  ├─ public/
│  ├─ src/
│  │  ├─ lib/
│  │  ├─ services/
│  │  ├─ store/
│  │  ├─ App.tsx
│  │  └─ main.tsx
│  ├─ package.json
│  └─ Dockerfile
├─ docker-compose.yml
└─ .env.example
```

## Quick Start

### Option 1: Run with Docker Compose

1. 复制环境变量模板并填写 Polygon API Key:

```bash
cp .env.example .env
```

2. 启动全部服务:

```bash
docker compose up --build
```

3. 打开服务:
- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:8000`
- API Docs: `http://localhost:8000/docs`

### Option 2: Run locally

#### Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

#### Frontend

```bash
cd frontend
npm install
npm run dev
```

默认前端开发服务运行在 `http://localhost:5173`。

## Environment Variables

根目录 `.env.example` 当前包含：

```env
POLYGON_API_KEY=your_polygon_api_key_here
```

说明：
- `POLYGON_API_KEY`：用于增强美股市场快照和热点数据能力。
- `VITE_API_URL` 与 `VITE_WS_URL` 已在 `docker-compose.yml` 中配置，也可以按本地环境自行覆盖。

## Core API Endpoints

### REST

- `GET /health`：健康检查
- `GET /api/v1/stocks/search?query=AAPL&market=US`：搜索股票
- `GET /api/v1/stocks/{ticker}/quote`：获取最新报价
- `GET /api/v1/stocks/{ticker}/history?period=1mo&interval=1d`：获取历史行情
- `GET /api/v1/stocks/{ticker}/recommendations`：获取相关股票推荐
- `GET /api/v1/market/hotspots?market=US`：获取市场热点
- `GET /api/v1/news?market=ALL&limit=200`：获取财经新闻
- `POST /api/v1/news/ai-insights`：获取新闻 AI 洞察
- `POST /api/v1/ai/context-insights`：获取页面级 AI 上下文分析

### WebSocket

- `WS /ws/stock-updates`

前端会通过该通道订阅股票实时更新。

## What This Repo Is Good For

- 做一个可继续扩展的股票终端原型
- 练习 `FastAPI + React` 的实时数据协作
- 作为市场热点页、资讯页、热力图页的前端实验场
- 接入自定义 AI 提供商，做轻量金融分析辅助

## Development Notes

- 后端 API 标题为 `FinSense Board API`
- 前端目前使用 Vite 开发环境和 TypeScript 严格模式
- 仓库内包含 Redis 与容器化配置，适合联调
- 若上传到 GitHub，建议同时补充 `LICENSE`、`screenshots/` 和 GitHub Actions CI

## Roadmap Ideas

- 增加更多行情源与降级策略
- 引入用户持久化 watchlist
- 增加更多指标和多图联动分析
- 为 README 补充真实页面截图和架构图
- 增加 CI / CD 与自动化测试 badge

## Acknowledgements

- [FastAPI](https://fastapi.tiangolo.com/)
- [React](https://react.dev/)
- [Vite](https://vitejs.dev/)
- [ApexCharts](https://apexcharts.com/)
- [yfinance](https://github.com/ranaroussi/yfinance)
- [AkShare](https://github.com/akfamily/akshare)
