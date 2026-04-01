**角色设定：** 你是一位精通高性能金融数据可视化、FastAPI 和 React 的资深全栈架构师。

**项目目标：** 构建一个高性能的单页 **股票行情看板系统 (FinSense Board)**。该系统需要实现实时股价推送、历史 K 线图展示以及基础的相关股票推荐。在 FastAPI 后端中集成 `yfinance` 库，创建一个稳健的股票数据服务层。要求能够获取实时价格（美股为主）和历史 K 线数据，并通过 WebSocket 推送。

***

### 🛠️ 技术栈与架构约束：

1. **项目结构：** 采用 Monorepo 模式，前端 `frontend`，后端 `backend`。
2. **后端 (FastAPI):**
   - **语言：** Python 3.10+，强制使用类型提示 (Type Hints)。
   - **架构：** 遵循干净架构（分为 `api` 路由, `core` 配置, `models` 数据库模型, `services` 业务逻辑, `schemas` Pydantic 模型）。
   - **异步化：** 所有 I/O 操作（API请求、数据库、WebSockets）必须使用 `async/await`。
   - **实时性：** 使用 **WebSockets** 实现实时价格推送到前端，严禁使用前端轮询。
   - **数据源：** 初始阶段使用 Mock 数据，但需封装 `StockDataService` 接口，以便后续无缝接入同花顺、聚宽或 Yahoo Finance 的 API。
3. **前端 (React):**
   - **语言：** TypeScript (Strict Mode)。
   - **状态管理：** 使用 **Zustand**（轻量且高性能，适合频繁更新的金融数据）。
   - **样式：** **Tailwind CSS**。要求设计成专业、高端的“深色模式”金融 UI（类似 Bloomberg 或同花顺专业版）。
   - **图表：** 使用 **ApexCharts** 或 **Recharts** 渲染高性能的时间序列 K 线图。

***

### 📋 核心功能需求：

#### 功能 1：自选股侧边栏 (Watchlist)

- 用户可以搜索股票（按代码或名称）。
- 自选股列表显示简易行情（现价、涨跌幅），涨显示红色（国内习惯），跌显示绿色。
- 点击列表中的股票，主图表实时切换。

#### 功能 2：专业 K 线图展示 (Main Chart)

- 渲染选定股票的历史 K 线。
- 支持切换时间维度（1分、5分、日K、周K）。
- 实现标准的图表交互：缩放、平移、十字准心、显示 OHLVC 详细数据的 Tooltip。
- **后端支持：** FastAPI 提供 `/api/v1/stocks/{ticker}/history` 接口，返回 1 年内的模拟历史数据。

#### 功能 3：WebSocket 实时行情推送

- 后端实现 `/ws/stock-updates` 接口。
- 客户端连接后发送订阅指令。后端模拟一个随机波动的行情源，每 1-2 秒通过 WebSocket 推送一次最新的价格数据（Price, Volume, Change%）。
- 前端图表和列表需响应式更新，**不允许刷新页面**。

#### 功能 4：相关股票推荐（非专利冲突算法）

- 在图表下方显示“同板块/相关股票推荐”。
- **算法实现：** 在后端实现一个简单的**基于行业的协同过滤 (Item-based CF)** 或 **同行业标签匹配**。
- *注意：* 严禁使用多智能体架构，只需简单的逻辑计算或查表。

***

### 🚀 生成指南（执行顺序）：

1. **根目录：** 生成 `docker-compose.yml`（包含 Redis 镜像用于消息分发）和基本的目录结构。
2. **后端核心：**
   - 实现 `backend/requirements.txt`。
   - 编写 `app/main.py` 入口。
   - 实现 `services/stock_data_service.py`（模拟数据生成器）。
   - 实现 WebSocket 逻辑 `api/ws/stock_updates.py`。
3. **前端核心：**
   - 使用 Vite 创建 TypeScript 模板。
   - 配置 Tailwind CSS。
   - 编写核心组件：`Sidebar.tsx`, `KLineChart.tsx`, `Dashboard.tsx`。
4. **联调：** 编写前端 `useStockWebSocket` 自定义 Hook，管理连接生命周期和状态同步。

***

**特别要求：** 请确保代码具有极高的可读性，特别是后端 Pydantic
