# mngm Gold Trading Bot — Full Deployment Guide

## What this bot does
- Logs into mngm.com every 60 seconds using your account
- Reads the live gold price (EGP/gram)
- Buys with your full wallet balance when price dips 1% from recent peak
- Sells your entire position when you're up 1.5% above buy price
- Triggers stop-loss sell if price drops 3% below buy price
- Emails you when wallet is low and a buying opportunity appears
- Compounds profits — reinvests everything on every trade
- Runs 24/7, never stops, never sleeps

---

## STEP 1 — Get a Hetzner VPS

1. Go to https://hetzner.com/cloud
2. Create an account
3. Create a new server:
   - Location: Nuremberg or Helsinki
   - Image: Ubuntu 22.04
   - Type: CX11 (cheapest, €3.79/month — more than enough)
   - Add your SSH key or use root password
4. Note your server IP address

---

## STEP 2 — Connect to your VPS

On your Mac, open Terminal and run:

```bash
ssh root@YOUR_SERVER_IP
```

---

## STEP 3 — Run the setup script

Copy and paste this entire block into your VPS terminal:

```bash
apt-get update -y && apt-get install -y python3 python3-pip python3-venv \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
  libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
  libgbm1 libasound2 fonts-liberation wget curl

mkdir -p /opt/mngm_bot
cd /opt/mngm_bot
python3 -m venv venv
source venv/bin/activate
pip install playwright python-dotenv
playwright install chromium
playwright install-deps chromium
```

---

## STEP 4 — Upload bot files

On your Mac (new Terminal window, NOT the SSH one):

```bash
scp /path/to/bot.py root@YOUR_SERVER_IP:/opt/mngm_bot/
scp /path/to/.env root@YOUR_SERVER_IP:/opt/mngm_bot/
```

---

## STEP 5 — Set up Gmail App Password for notifications

Your Gmail account needs an "App Password" (not your regular password) for the bot to send emails:

1. Go to https://myaccount.google.com/security
2. Enable 2-Step Verification (if not already on)
3. Go to https://myaccount.google.com/apppasswords
4. Select app: Mail | Select device: Other → type "mngm bot"
5. Copy the 16-character password generated

Then on your VPS:
```bash
nano /opt/mngm_bot/.env
```
Find the line `SMTP_PASS=` and paste your App Password there.
Save: Ctrl+X → Y → Enter

---

## STEP 6 — Create the systemd service (auto-restart forever)

```bash
cat > /etc/systemd/system/mngm-bot.service << 'EOF'
[Unit]
Description=mngm Gold Trading Bot
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/mngm_bot
ExecStart=/opt/mngm_bot/venv/bin/python bot.py
Restart=always
RestartSec=30
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable mngm-bot
systemctl start mngm-bot
```

---

## STEP 7 — Verify it's running

```bash
# Watch live logs
tail -f /opt/mngm_bot/bot.log

# Check service status
systemctl status mngm-bot

# See all trades
cat /opt/mngm_bot/trades.csv

# See current bot state (position, balance, etc.)
cat /opt/mngm_bot/state.json
```

---

## Managing the bot

```bash
# Stop bot
systemctl stop mngm-bot

# Restart bot
systemctl restart mngm-bot

# View last 50 log lines
tail -50 /opt/mngm_bot/bot.log
```

---

## Tuning the strategy

Edit `/opt/mngm_bot/.env` and change:

| Setting | Default | Meaning |
|---|---|---|
| SELL_TARGET_PCT | 1.5 | Sell when up 1.5% from buy price |
| STOP_LOSS_PCT | 3.0 | Emergency sell if down 3% |
| DIP_BUY_PCT | 1.0 | Buy when price drops 1% from peak |
| CHECK_INTERVAL_SECONDS | 60 | Check price every 60 seconds |
| LOW_WALLET_THRESHOLD | 500 | Alert you if wallet below 500 EGP |

After editing, restart: `systemctl restart mngm-bot`

---

## Understanding the emails you'll receive

| Email subject | Meaning |
|---|---|
| 🟢 Bought X grams | Bot bought gold — you're now in a position |
| 🟢 Sold @ X EGP — Profit: +Y EGP | Successful trade, profit taken |
| 🔴 Sold @ X EGP — Profit: -Y EGP | Stop-loss triggered, small loss taken |
| 💰 Great buying opportunity! Add funds | Price dipped but wallet is empty — top up |
| 🚨 Error / Bot stopped | Something crashed — check VPS |

---

## Important notes

1. **Keep your mngm wallet topped up** — the bot can only trade with what's in there
2. **Sell proceeds appear in wallet within ~5 minutes** — bot waits before next trade
3. **The bot never touches your bank account** — only your mngm wallet
4. **Trade log is at** `/opt/mngm_bot/trades.csv` — full history forever
5. **Monthly VPS cost** — ~€4 (~200 EGP). Negligible vs trading profits.

---

## Emergency — stop all trading immediately

```bash
ssh root@YOUR_SERVER_IP
systemctl stop mngm-bot
```

Then log into mngm.com manually to check/close any open position.
