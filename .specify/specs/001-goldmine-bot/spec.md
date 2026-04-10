# Spec: mngm.com Autonomous Gold Trading Bot

**Spec ID**: 001
**Status**: Draft
**Created**: 2026-04-10
**Stack**: Python 3.10+, Playwright (Chromium), systemd, Gmail SMTP

---

## 1. Overview

**Goldmine** is a 24/7 autonomous trading bot that logs into [mngm.com](https://mngm.com) and
executes a simple, compounding dip-buy/gain-sell strategy on fractional gold priced in EGP (Egyptian Pounds).

The bot runs on a cheap Hetzner VPS (~€4/month), is managed by `systemd` (auto-restarts on crash),
and emails the operator on every significant event.

---

## 2. Goals

| Goal | Description |
|---|---|
| Autonomous operation | Run 24/7 without any human input |
| Compound profits | Reinvest full wallet balance on every trade |
| Price monitoring | Scrape live EGP/gram price from mngm.com every 60s |
| Buy dips | Trigger a BUY when price drops ≥ DIP_BUY_PCT% from rolling peak |
| Sell gains | Trigger a SELL when position is up ≥ SELL_TARGET_PCT% |
| Notify operator | Email on every BUY, SELL, error, low wallet, or deep drawdown |
| Persist state | Survive crashes and restarts cleanly via state.json |

---

## 3. System Architecture

```
┌─────────────────────────────────────────────────┐
│                  VPS (Hetzner CX11)             │
│                                                 │
│  systemd  ──► bot.py (Python + Playwright)      │
│                  │                              │
│                  ├── mngm.com (Chromium, headless)
│                  ├── state.json   (position state)
│                  ├── trades.csv   (trade audit log)
│                  ├── bot.log      (runtime logs)
│                  └── Gmail SMTP   (notifications)│
└─────────────────────────────────────────────────┘
```

---

## 4. Trading Strategy

### 4a. Dip Detection (BUY Logic)
- The bot continuously tracks a **rolling peak price** (`peak_price` in state).
- Every cycle it computes: `dip_pct = (peak - current_price) / peak * 100`
- If `dip_pct >= DIP_BUY_PCT` AND `wallet >= LOW_WALLET_THRESHOLD`:
  - Execute a full-balance BUY via Playwright browser automation
  - Record position: buy price, grams acquired, EGP invested

### 4b. Gain Detection (SELL Logic)
- While in position, every cycle computes: `change_pct = (price - buy_price) / buy_price * 100`
- If `change_pct >= SELL_TARGET_PCT`:
  - Execute a SELL of all held grams
  - Record profit, update wallet balance, reset position

### 4c. No Stop-Loss (Current Design)
- The bot intentionally holds through any drawdown without a stop-loss.
- If down more than 2%, a "holding update" email is sent (max once per 6h).

> ⚠️ **DISCREPANCY FOUND**: `DEPLOYMENT.md` documents a `STOP_LOSS_PCT=3.0` parameter,
> but `bot.py` does NOT implement any stop-loss logic. This is a known gap.

### 4d. Compounding
- After every SELL, the full proceeds land back in the mngm wallet.
- The next BUY uses the entire new wallet balance — full reinvestment.

---

## 5. Configuration (`.env`)

| Variable | Default | Description |
|---|---|---|
| `MNGM_EMAIL` | — | mngm.com login email |
| `MNGM_PASSWORD` | — | mngm.com login password |
| `NOTIFY_EMAIL` | — | Email to receive all alerts |
| `SELL_TARGET_PCT` | `0.7` | Sell when position up ≥ 0.7% |
| `DIP_BUY_PCT` | `0.5` | Buy when price dips ≥ 0.5% from peak |
| `LOW_WALLET_THRESHOLD` | `500` | Min EGP in wallet to execute a buy |
| `CHECK_INTERVAL_SECONDS` | `60` | Price check frequency |
| `SMTP_HOST` | `smtp.gmail.com` | SMTP server |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_USER` | — | Gmail address |
| `SMTP_PASS` | — | Gmail App Password |

---

## 6. State Schema (`state.json`)

```json
{
  "in_position": false,
  "buy_price": null,
  "buy_time": null,
  "grams_held": null,
  "egp_invested": null,
  "peak_price": null,
  "wallet_balance": null,
  "total_profit": 0.0,
  "trade_count": 0
}
```

---

## 7. Notification Events

| Event | Trigger | Frequency |
|---|---|---|
| 🟢 Bought | After successful BUY execution | Per trade |
| 💰 Sold + Profit | After successful SELL execution | Per trade |
| 📊 Holding Update | Position down > 2% | Max once per 6h |
| 💰 Add Funds | Dip triggered but wallet too low | Max once per 1h |
| 🚨 Bot Error | Fatal unhandled exception | Per crash |

---

## 8. Deployment

- **VPS**: Hetzner CX11 (Ubuntu 22.04, ~€4/month)
- **Service**: `systemd` unit `/etc/systemd/system/mngm-bot.service`
- **Auto-restart**: `Restart=always`, `RestartSec=30`
- **Files**: `/opt/mngm_bot/` (bot.py, .env, state.json, trades.csv, bot.log)

---

## 9. Known Issues & Gaps

| Issue | Severity | Status |
|---|---|---|
| `STOP_LOSS_PCT` in DEPLOYMENT.md not in bot.py | High | Open |
| DEPLOYMENT.md says DIP=1.0% / SELL=1.5%, but bot.py defaults are DIP=0.5% / SELL=0.7% | Medium | Open |
| Playwright selectors are try/except brittle — no validation after buy/sell | High | Open |
| No confirmation that order was actually placed (just "submitted") | High | Open |
| Wallet balance can be stale (falls back to cached value on parse failure) | Medium | Open |
| No position size validation — invests entire wallet even if < min order size | Medium | Open |
