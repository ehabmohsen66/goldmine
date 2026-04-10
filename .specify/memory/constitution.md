<!--
Sync Impact Report:
Version change: 0.0.0 → 1.0.0
Added sections: Core Principles, Technology Constraints, Operational Rules, Governance
Removed sections: N/A (initial draft)
Templates requiring updates: None
-->

# Goldmine (mngm.com Gold Trading Bot) Constitution

## Core Principles

### I. Capital Preservation Above All (NON-NEGOTIABLE)
The bot MUST never expose capital to runaway loss scenarios. The code must
accurately reflect the intended risk model at all times. Any mismatch between
the DEPLOYMENT.md strategy description and the actual bot.py logic must be
treated as a critical bug and resolved immediately.

### II. 24/7 Autonomous Operation
The system is designed to run continuously without human intervention.
Every recoverable error (network timeouts, page load failures, scraping
mismatches) MUST be caught, logged, and silently retried. Only fatal,
irrecoverable failures may trigger a crash + email alert.

### III. Single Source of Truth for State
All bot state (position, buy price, grams held, wallet balance, profit)
MUST be persisted to `state.json` after every meaningful change.
The bot must be safely restartable at any point — restoring from
`state.json` must produce identical behaviour to an uninterrupted run.

### IV. Transparent Trade Auditing
Every BUY and SELL action MUST be appended to `trades.csv` with full
context (timestamp, price, EGP amount, grams, profit, balance).
Log lines MUST be descriptive enough that the operator can reconstruct
exactly what the bot did and why.

### V. Notification-Driven Operator Awareness
The operator MUST be emailed on every trade, every error, and every
"add funds" opportunity. Holding-position alerts must be rate-limited
(max once per 6 hours) to avoid notification fatigue. No silent failures.

## Technology Constraints

- **Runtime**: Python 3.10+ inside a `venv` on Ubuntu 22.04 VPS (Hetzner CX11)
- **Browser Automation**: Playwright (Chromium, headless)
- **Target Platform**: mngm.com — fractional gold buying/selling (EGP)
- **Config**: All secrets and thresholds via `.env` (never hardcoded)
- **Service**: Managed by `systemd` with `Restart=always` (auto-recovery)
- **Email**: Gmail SMTP via App Password

## Operational Rules

- **Buy trigger**: Price drops ≥ `DIP_BUY_PCT`% from rolling peak AND wallet ≥ `LOW_WALLET_THRESHOLD` EGP
- **Sell trigger**: Position gain ≥ `SELL_TARGET_PCT`%
- **Compounding**: Full wallet balance reinvested on every BUY — no partial fills
- **Strategy sync**: bot.py logic MUST match DEPLOYMENT.md parameter table at all times

## Governance

This constitution defines the non-negotiable operational contract for the bot.
Any feature addition, bug fix, or strategy change MUST be validated against all
five core principles before implementation. Amendments require updating both
this file and DEPLOYMENT.md in the same commit.

**Version**: 1.0.0 | **Ratified**: 2026-04-10 | **Last Amended**: 2026-04-10
