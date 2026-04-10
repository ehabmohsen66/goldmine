# Plan: Goldmine — mngm.com Gold Trading Dashboard (Vercel)

**Plan ID**: 001
**Spec**: 001-goldmine-bot
**Status**: Approved
**Created**: 2026-04-10

---

## Architecture Decision: Python Bot → Next.js + Vercel Cron

The original `bot.py` uses Playwright for browser automation, which can't run on Vercel natively.
The new architecture uses:

| Layer | Solution |
|---|---|
| **Frontend** | Next.js 15 (App Router) — dashboard UI |
| **Trading Loop** | Vercel Cron Job → API Route (`/api/cron/tick`) |
| **Browser Automation** | `@sparticuz/chromium` + `playwright-core` (Vercel-compatible) |
| **State & Trade Log** | Vercel KV (Redis) — fast, serverless |
| **Config** | Vercel Environment Variables |
| **Notifications** | Nodemailer via Gmail SMTP (API route) |

---

## Design System (from ui-ux-pro-max)

- **Style**: Dark Mode (OLED) — deep black, OLED-optimised
- **Primary**: `#1C1917` (stone-900) | **Accent/CTA**: `#CA8A04` (gold)
- **Font**: IBM Plex Sans (financial, trustworthy)
- **Charts**: ApexCharts — Area (price history) + Streaming line (live price)
- **Effects**: Minimal gold glow, glassmorphism cards, smooth transitions

---

## Pages & Routes

```
app/
├── page.tsx                    → Dashboard (main view)
├── trades/page.tsx             → Full trade history table
├── settings/page.tsx           → Bot config (env vars form)
├── api/
│   ├── cron/tick/route.ts      → Vercel Cron: main bot tick (every 60s)
│   ├── bot/status/route.ts     → GET current state
│   ├── bot/start/route.ts      → POST start bot
│   ├── bot/stop/route.ts       → POST stop bot
│   └── trades/route.ts         → GET trades log
```

---

## Component Plan

```
components/
├── layout/
│   ├── Navbar.tsx              → Top nav with bot status indicator
│   └── Sidebar.tsx             → Navigation sidebar
├── dashboard/
│   ├── BotStatusCard.tsx       → Running/Stopped badge + controls
│   ├── PositionCard.tsx        → Current position (grams, buy price, P/L)
│   ├── WalletCard.tsx          → Wallet balance in EGP
│   ├── ProfitCard.tsx          → All-time profit + trade count
│   ├── PriceChart.tsx          → ApexCharts area chart (price history)
│   └── LivePriceTicker.tsx     → Animated live price display
├── trades/
│   └── TradeTable.tsx          → Sortable/filterable trade history
└── ui/
    ├── GlassCard.tsx           → Reusable glassmorphism card
    ├── StatusBadge.tsx         → Colored status pill
    └── GoldButton.tsx          → CTA button with gold glow
```

---

## Vercel Cron Configuration (`vercel.json`)

```json
{
  "crons": [{
    "path": "/api/cron/tick",
    "schedule": "* * * * *"
  }]
}
```

---

## Data Flow

```
Every 60s:
Vercel Cron → /api/cron/tick
  → Check KV: is bot enabled?
  → Launch Chromium (sparticuz)
  → Login to mngm.com
  → Scrape price
  → Read state from KV
  → Apply strategy logic
  → Execute BUY or SELL if triggered
  → Write new state to KV
  → Append trade to KV list
  → Send email if needed
  → Return 200

Dashboard page:
  → Polls /api/bot/status every 30s
  → Renders real-time metrics
```

---

## Implementation Order

1. `vercel.json` + `package.json` setup
2. Vercel KV schema + helper lib (`lib/kv.ts`)
3. Design system CSS (`globals.css`)
4. UI components (GlassCard, GoldButton, etc.)
5. Dashboard page + all stat cards
6. PriceChart with ApexCharts
7. `/api/bot/status` route
8. `/api/cron/tick` route (core bot logic)
9. Trades page
10. Settings page
11. `vercel.json` cron config
