# Solana Autonomous Quant & AI Sniper Bot (v7)

Hệ thống giao dịch định lượng & trí tuệ nhân tạo tự động hóa 6 giai đoạn trên mạng Solana (**Scanner → Security → Intelligence → Adaptive Entry → Risk → Execution**), tối ưu lợi nhuận ròng sau phí & độ ổn định Drawdown trên mọi trạng thái thị trường. Hỗ trợ **chạy trực tiếp không cần mua gói RPC (`DISCOVERY_MODE=FREE_FEED`)** hoặc **Paid RPC + Jito Bundle**, điều khiển toàn diện qua **Telegram Dashboards**.

## Nâng cấp Kiến trúc v7 (10 Module mới + 8 Fix Lỗi Lõi)

1. **AI Token Intelligence (`src/ai/intelligenceEngine.ts`)**: Feature-vector Logistic Prediction Engine với Confidence Calibration, chấm điểm `tokenQualityScore (0–100)`, dự đoán `pumpProbability` / `rugProbability`, giai đoạn vòng đời (`lifecycleStage`), `entryTiming` và xếp hạng Token Ranking.
2. **Orderflow Analyzer nâng cấp (`src/filters/orderflow.ts`)**: Inspect full balance deltas trên mọi tài khoản transaction (`getAccountKeys` + native SOL + WSOL + target mint), tính **Cumulative Volume Delta (CVD)**, Orderflow Imbalance đa khung (`1m / 5m / 15m`), Whale Net Flow, Sybil/Coordinated Buy Detection, tách biệt rõ nguồn `ONCHAIN_FULL_BALANCE` và `FREE_FEED_AGGREGATED`.
3. **Smart Money Intelligence (`src/smartmoney/walletIntelligence.ts`)**: Theo dõi Smart Wallet Database, xếp hạng hiệu suất ví, clustering ví mua phối hợp, cảnh báo Insider/Sniper và Creator Reputation.
4. **Market Regime Detection (`src/market/regimeDetector.ts`)**: Phân loại `BULLISH`, `BEARISH`, `SIDEWAYS`, `HIGH_VOLATILITY` dựa trên biến động SOL 1h/24h, memecoin breadth và thanh khoản; tự động chọn chiến lược và ngưỡng AI phù hợp.
5. **Adaptive Entry Engine (`src/strategy/entryEngine.ts`)**: Đánh giá 5 chiến lược (`EARLY_MOMENTUM`, `BREAKOUT`, `PULLBACK`, `LIQUIDITY_INFLOW`, `SMART_MONEY`), xác nhận đa khung thời gian (MTF), ngưỡng động và kiểm tra entry slippage.
6. **Institutional Risk Management (`src/strategy/riskSizing.ts`)**: Định cỡ lệnh theo thanh khoản thực tế, dự tính trước Price Impact & Estimated Exit Slippage, giới hạn lỗ ngày & **Weekly Loss Limit**, **Profit Protection**, giới hạn Correlated Exposure mà AI không được phép vượt qua.
7. **Intelligent Exit Engine (`src/strategy/positionManager.ts`)**: Kiểm tra route bán thực tế (`verifyExitRouteQuote`) trước khi kích hoạt `RUG_DRAIN` / Emergency Exit (tránh panic-sell oan khi RPC lag), Adaptive Trailing SL, Orderflow Reversal Exit, Whale Distribution Exit, Volatility Exit, Partial Profit Lock & Continuous Security Re-Assessment.
8. **Backtesting & Walk-Forward Optimizer (`src/backtesting/` & `src/optimization/`)**: Mô phỏng quá khứ kèm phí & trượt giá thực tế, **Monte Carlo Simulation (300x)**, **Strict Chronological Walk-Forward Out-Of-Sample Validation**, thống kê Rejected Counterfactuals. Không bao giờ tự đẩy tham số mới lên LIVE khi chưa phê duyệt.
9. **Continuous Learning & Agents (`src/learning/` & `src/agents/`)**: Lưu toàn bộ snapshot (`BOUGHT` & `REJECTED`) cùng kết quả giá sau `1m / 5m / 15m / 1h / 24h`, theo dõi Accuracy & Brier Calibration, phát hiện Model Drift, retrain model dạng `CANDIDATE` (duyệt qua `/ai approve <ver>`), chạy Watchdog `MarketRegimeAgent`, `HorizonCollectorAgent`, `DriftMonitorAgent`.
10. **Telegram Dashboards v7 (`src/telegram/bot.ts`)**: 24 công tắc bật/tắt (`/toggles`), chỉnh/reset Paper (`/paper`, `/resetpaper`), xóa tin đặt lệnh khi tính TP/SL, Hot-Update code qua `.ts`/`.zip`, cùng các dashboard `/ai`, `/rank`, `/smartmoney`, `/orderflow`, `/regime`, `/backtest`, `/optimize`, `/perf`, `/accuracy`, `/exec`, `/agents`, `/social`.

## Cấu trúc dự án

```text
solana-ai-sniper-bot/
├── src/
│   ├── ai/              # intelligenceEngine.ts (Prediction, Calibration, Ranking)
│   ├── smartmoney/      # walletIntelligence.ts (Smart Wallets, Whales, Clusters)
│   ├── market/          # regimeDetector.ts (Bullish/Bearish/Sideways/HighVol)
│   ├── social/          # socialIntelligence.ts (X/TG Scanner, Narrative, Fake Hype)
│   ├── backtesting/     # backtestEngine.ts (Monte Carlo, Walk-Forward OOS)
│   ├── optimization/    # strategyOptimizer.ts (In-Sample/OOS Parameter Search)
│   ├── learning/        # continuousLearning.ts (Accuracy, Brier, Drift, Candidate Retrain)
│   ├── agents/          # agentCoordinator.ts (Autonomous Background Agents)
│   ├── config/          # env.ts & runtimeConfig.ts (v7 24 Toggles + Risk Limits)
│   ├── core/            # rpc.ts (Multi-RPC Health), jito.ts, wallet.ts, simulation.ts, types.ts
│   ├── listeners/       # dexListeners.ts (Cross-DEX, Migration, Pool History)
│   ├── security/        # antiRug.ts (Verified vs Unverified, Sybil, Re-Assessment)
│   ├── filters/         # orderflow.ts (Full-Tx SOL Deltas, CVD, MTF, Sybil)
│   ├── execution/       # router.ts (Dup Lock, Exit Route Check, Recon, Latency)
│   ├── strategy/        # entryEngine.ts, riskSizing.ts, positionManager.ts
│   ├── analytics/       # database.ts, performance.ts, chartRenderer.ts
│   ├── telegram/        # bot.ts (v7 Dashboards & Controls)
│   ├── updater/         # hotUpdater.ts
│   ├── supervisor.ts    # Watchdog auto-heal & rollback
│   └── index.ts         # 6-Stage Pipeline Orchestrator
├── package.json
├── tsconfig.json
└── .env.example
```

## Cài đặt & Chạy nhanh

```bash
cp .env.example .env
# Điền TELEGRAM_BOT_TOKEN & ALLOWED_USER_ID
npm install
npm run build
npm start
```
