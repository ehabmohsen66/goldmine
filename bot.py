"""
mngm.com Autonomous Gold Trading Bot
Runs 24/7 on VPS — monitors price every 60s, buys dips, sells gains, compounds.

Strategy:
  - Buy when price drops 0.5% from recent peak
  - Sell when price is 0.7% above buy price (net ~0.2% after spread)
  - NO stop-loss — gold always recovers, we hold through any dip
  - Full balance reinvested every trade (compounding)
"""

import os
import csv
import json
import time
import smtplib
import logging
import traceback
import re
from datetime import datetime
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

load_dotenv()

# ── Config ────────────────────────────────────────────────────────────────────
MNGM_EMAIL       = os.getenv("MNGM_EMAIL")
MNGM_PASSWORD    = os.getenv("MNGM_PASSWORD")
NOTIFY_EMAIL     = os.getenv("NOTIFY_EMAIL")
SELL_TARGET_PCT  = float(os.getenv("SELL_TARGET_PCT", 0.7))
DIP_BUY_PCT      = float(os.getenv("DIP_BUY_PCT", 0.5))
LOW_WALLET       = float(os.getenv("LOW_WALLET_THRESHOLD", 500))
INTERVAL         = int(os.getenv("CHECK_INTERVAL_SECONDS", 60))
SMTP_HOST        = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT        = int(os.getenv("SMTP_PORT", 587))
SMTP_USER        = os.getenv("SMTP_USER")
SMTP_PASS        = os.getenv("SMTP_PASS")

PRODUCT_URL  = "https://mngm.com/buy/metals/fractional/8"
CHECKOUT_URL = "https://mngm.com/account/checkout/digital"
LOGIN_URL    = "https://mngm.com/account/login"
LOG_FILE     = "trades.csv"
STATE_FILE   = "state.json"

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler("bot.log"),
        logging.StreamHandler()
    ]
)
log = logging.getLogger(__name__)

# ── State ─────────────────────────────────────────────────────────────────────
def load_state():
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            return json.load(f)
    return {
        "in_position": False,
        "buy_price": None,
        "buy_time": None,
        "grams_held": None,
        "egp_invested": None,
        "peak_price": None,
        "wallet_balance": None,
        "total_profit": 0.0,
        "trade_count": 0
    }

def save_state(state):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)

# ── Trade log ─────────────────────────────────────────────────────────────────
def log_trade(action, price, egp, grams, profit, balance):
    file_exists = os.path.exists(LOG_FILE)
    with open(LOG_FILE, "a", newline="") as f:
        writer = csv.writer(f)
        if not file_exists:
            writer.writerow(["timestamp", "action", "price_egp_g",
                             "egp_amount", "grams", "profit_egp", "wallet_balance"])
        writer.writerow([
            datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            action, round(price, 2), round(egp, 2),
            round(grams, 6), round(profit, 2), round(balance, 2)
        ])

# ── Email ─────────────────────────────────────────────────────────────────────
def send_email(subject, body):
    if not SMTP_PASS:
        log.warning("SMTP_PASS not set — skipping email")
        return
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"]    = SMTP_USER
        msg["To"]      = NOTIFY_EMAIL
        msg.attach(MIMEText(body, "html"))
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as s:
            s.starttls()
            s.login(SMTP_USER, SMTP_PASS)
            s.sendmail(SMTP_USER, NOTIFY_EMAIL, msg.as_string())
        log.info(f"Email sent: {subject}")
    except Exception as e:
        log.error(f"Email failed: {e}")

def email_bought(price, grams, egp, trade_num):
    send_email(
        f"🟢 BOT BOUGHT — {grams:.4f}g @ {price:,.2f} EGP/g",
        f"""<h2 style="color:#16a34a;font-family:sans-serif">Gold Purchased — Trade #{trade_num}</h2>
        <table style="font-family:sans-serif;font-size:15px;border-collapse:collapse">
        <tr><td style="padding:6px 16px 6px 0;color:#6b7280">Price</td><td><b>{price:,.2f} EGP/gram</b></td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#6b7280">Spent</td><td><b>{egp:,.2f} EGP</b></td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#6b7280">Gold acquired</td><td><b>{grams:.6f} grams</b></td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#6b7280">Will sell at</td><td><b>{price*(1+SELL_TARGET_PCT/100):,.2f} EGP/gram (+{SELL_TARGET_PCT}%)</b></td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#6b7280">Time</td><td>{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</td></tr>
        </table>"""
    )

def email_sold(buy_price, sell_price, grams, profit, balance, trade_count, total_profit):
    send_email(
        f"💰 BOT SOLD — Profit: +{profit:,.2f} EGP | Total earned: +{total_profit:,.2f} EGP",
        f"""<h2 style="color:#16a34a;font-family:sans-serif">Trade #{trade_count} Complete</h2>
        <table style="font-family:sans-serif;font-size:15px;border-collapse:collapse">
        <tr><td style="padding:6px 16px 6px 0;color:#6b7280">Bought at</td><td>{buy_price:,.2f} EGP/gram</td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#6b7280">Sold at</td><td><b>{sell_price:,.2f} EGP/gram</b></td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#6b7280">Grams</td><td>{grams:.6f} g</td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#6b7280">Profit this trade</td><td style="color:#16a34a"><b>+{profit:,.2f} EGP</b></td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#6b7280">All-time profit</td><td style="color:#16a34a"><b>+{total_profit:,.2f} EGP</b></td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#6b7280">Wallet balance</td><td><b>{balance:,.2f} EGP</b></td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#6b7280">Total trades</td><td>{trade_count}</td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#6b7280">Time</td><td>{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</td></tr>
        </table>
        <p style="font-family:sans-serif;font-size:13px;color:#6b7280">
        Bot is watching for the next dip to buy again.</p>"""
    )

def email_holding_update(buy_price, current_price, grams, change_pct):
    send_email(
        f"📊 BOT HOLDING — Down {abs(change_pct):.1f}% — patient, no stop-loss",
        f"""<h2 style="color:#d97706;font-family:sans-serif">Holding Position — Waiting for Recovery</h2>
        <p style="font-family:sans-serif;color:#374151">Gold is below your buy price.
        The bot is holding as instructed — no stop-loss. Gold will recover.</p>
        <table style="font-family:sans-serif;font-size:15px;border-collapse:collapse">
        <tr><td style="padding:6px 16px 6px 0;color:#6b7280">Buy price</td><td>{buy_price:,.2f} EGP/gram</td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#6b7280">Current price</td><td>{current_price:,.2f} EGP/gram</td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#6b7280">Currently</td><td style="color:#dc2626">{change_pct:+.2f}%</td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#6b7280">Will sell at</td><td>{buy_price*(1+SELL_TARGET_PCT/100):,.2f} EGP/gram</td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#6b7280">Gold held</td><td>{grams:.6f} grams</td></tr>
        </table>"""
    )

def email_add_funds(price, wallet, dip_pct, peak):
    send_email(
        f"💰 ADD FUNDS — Gold dipped {dip_pct:.1f}% — great buy opportunity!",
        f"""<h2 style="color:#d97706;font-family:sans-serif">Buying Opportunity — Wallet Too Low</h2>
        <p style="font-family:sans-serif;color:#374151">
        Gold dropped {dip_pct:.2f}% but your wallet doesn't have enough to buy.
        Top up now to capture this.</p>
        <table style="font-family:sans-serif;font-size:15px;border-collapse:collapse">
        <tr><td style="padding:6px 16px 6px 0;color:#6b7280">Recent peak</td><td>{peak:,.2f} EGP/gram</td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#6b7280">Current price</td><td><b>{price:,.2f} EGP/gram</b></td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#6b7280">Drop</td><td style="color:#16a34a"><b>{dip_pct:.2f}% below peak</b></td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#6b7280">Your wallet</td><td style="color:#dc2626">{wallet:,.2f} EGP</td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#6b7280">Time</td><td>{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</td></tr>
        </table>
        <p style="margin-top:16px">
        <a href="https://mngm.com/account" style="background:#16a34a;color:white;
        padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:500">
        Top up mngm Wallet →</a></p>"""
    )

def email_error(error_msg):
    send_email(
        "🚨 BOT STOPPED — Error needs attention",
        f"""<h2 style="color:#dc2626;font-family:sans-serif">Bot Error</h2>
        <pre style="font-family:monospace;font-size:12px;background:#f3f4f6;
        padding:16px;border-radius:8px">{error_msg}</pre>
        <p style="font-family:sans-serif">SSH into VPS and run:
        <code>systemctl restart mngm-bot</code></p>"""
    )

# ── Browser bot ───────────────────────────────────────────────────────────────
class MngmBot:
    def __init__(self, playwright):
        self.browser = playwright.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
        )
        self.context = self.browser.new_context(
            viewport={"width": 1280, "height": 800},
            user_agent=(
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                "Chrome/120.0.0.0 Safari/537.36"
            )
        )
        self.page = self.context.new_page()

    def close(self):
        try:
            self.browser.close()
        except:
            pass

    def login(self):
        log.info("Logging in...")
        self.page.goto(LOGIN_URL, wait_until="networkidle", timeout=30000)
        self.page.wait_for_timeout(2000)

        for sel in ['input[name="email"]', 'input[type="email"]',
                    'input[placeholder*="mail" i]', 'input[placeholder*="Phone" i]']:
            try:
                if self.page.query_selector(sel):
                    self.page.fill(sel, MNGM_EMAIL)
                    break
            except: continue

        for sel in ['input[name="password"]', 'input[type="password"]']:
            try:
                if self.page.query_selector(sel):
                    self.page.fill(sel, MNGM_PASSWORD)
                    break
            except: continue

        for sel in ['button[type="submit"]', 'button:has-text("Sign in")',
                    'button:has-text("Login")', 'input[type="submit"]']:
            try:
                if self.page.query_selector(sel):
                    self.page.click(sel)
                    break
            except: continue

        self.page.wait_for_timeout(4000)
        if "login" in self.page.url.lower():
            raise Exception("Login failed — check credentials in .env")
        log.info("Login successful")

    def get_price(self):
        self.page.goto(PRODUCT_URL, wait_until="networkidle", timeout=30000)
        self.page.wait_for_timeout(2000)
        content = self.page.inner_text("body")
        match = re.search(r"\(?(\d[\d,]+\.?\d*)\s*EGP\s*/\s*gram\)?", content)
        if not match:
            raise Exception("Could not find price on page")
        price = float(match.group(1).replace(",", ""))
        log.info(f"Price: {price:,.2f} EGP/gram")
        return price

    def get_wallet_balance(self):
        try:
            self.page.goto(CHECKOUT_URL, wait_until="networkidle", timeout=30000)
            self.page.wait_for_timeout(2000)
            content = self.page.inner_text("body")
            match = re.search(r"[Ww]allet[^\d]{0,30}([\d,]+\.?\d*)\s*EGP", content)
            if match:
                bal = float(match.group(1).replace(",", ""))
                log.info(f"Wallet: {bal:,.2f} EGP")
                return bal
        except Exception as e:
            log.warning(f"Wallet read failed: {e}")
        return None

    def execute_buy(self, egp_amount):
        log.info(f"Executing BUY — {egp_amount:,.2f} EGP")
        self.page.goto(PRODUCT_URL, wait_until="networkidle", timeout=30000)
        self.page.wait_for_timeout(2000)

        # Select EGP input mode
        for sel in ['label:has-text("EGP")', 'input[value="egp"]', '#egp']:
            try:
                el = self.page.query_selector(sel)
                if el: el.click(); self.page.wait_for_timeout(500); break
            except: continue

        # Enter EGP amount
        for sel in ['input[type="number"]', '.amount-input', 'input[placeholder="0"]']:
            try:
                el = self.page.query_selector(sel)
                if el:
                    el.triple_click()
                    el.type(str(int(egp_amount)))
                    self.page.wait_for_timeout(1000)
                    break
            except: continue

        # Click Checkout
        for sel in ['button:has-text("Checkout")', '.checkout-btn', 'input[value="Checkout"]']:
            try:
                el = self.page.query_selector(sel)
                if el: el.click(); self.page.wait_for_timeout(3000); break
            except: continue

        # Select Mngm Wallet payment
        for sel in [':has-text("Mngm Wallet")', 'text=Wallet', '[class*="wallet"]']:
            try:
                el = self.page.query_selector(sel)
                if el: el.click(); self.page.wait_for_timeout(2000); break
            except: continue

        # Confirm
        for sel in ['button:has-text("Confirm")', 'button:has-text("Place Order")',
                    'button:has-text("Pay")', 'input[type="submit"]']:
            try:
                el = self.page.query_selector(sel)
                if el: el.click(); self.page.wait_for_timeout(5000); break
            except: continue

        log.info("BUY submitted")
        return True

    def execute_sell(self, grams):
        log.info(f"Executing SELL — {grams:.6f} grams")
        self.page.goto("https://mngm.com/account", wait_until="networkidle", timeout=30000)
        self.page.wait_for_timeout(2000)

        for sel in ['a:has-text("Sell")', 'button:has-text("Sell")', '[href*="sell"]']:
            try:
                el = self.page.query_selector(sel)
                if el: el.click(); self.page.wait_for_timeout(2000); break
            except: continue

        for sel in ['input[type="number"]', '.sell-input', 'input[placeholder="0"]']:
            try:
                el = self.page.query_selector(sel)
                if el:
                    el.triple_click()
                    el.type(str(round(grams, 6)))
                    self.page.wait_for_timeout(1000)
                    break
            except: continue

        for sel in ['button:has-text("Sell")', 'button:has-text("Confirm")', 'input[type="submit"]']:
            try:
                el = self.page.query_selector(sel)
                if el: el.click(); self.page.wait_for_timeout(5000); break
            except: continue

        log.info("SELL submitted")
        return True


# ── Main loop ─────────────────────────────────────────────────────────────────
def run_bot():
    state                = load_state()
    last_add_funds_alert = 0
    last_holding_alert   = 0

    log.info("=" * 60)
    log.info("mngm Gold Bot STARTED")
    log.info(f"  Sell target : +{SELL_TARGET_PCT}%")
    log.info(f"  Dip trigger : -{DIP_BUY_PCT}% from peak")
    log.info(f"  Stop-loss   : NONE — hold forever")
    log.info(f"  Interval    : {INTERVAL}s")
    log.info("=" * 60)

    with sync_playwright() as pw:
        bot = MngmBot(pw)
        try:
            bot.login()

            while True:
                try:
                    price = bot.get_price()

                    # ── IN POSITION ───────────────────────────────────────
                    if state["in_position"]:
                        buy_price  = state["buy_price"]
                        grams      = state["grams_held"]
                        egp_in     = state["egp_invested"]
                        change_pct = (price - buy_price) / buy_price * 100

                        log.info(
                            f"[HOLDING] {price:,.2f} EGP/g | "
                            f"Buy: {buy_price:,.2f} | "
                            f"P/L: {change_pct:+.2f}% | "
                            f"Need: +{SELL_TARGET_PCT}%"
                        )

                        if change_pct >= SELL_TARGET_PCT:
                            log.info(f"TARGET HIT +{change_pct:.2f}% — SELLING")
                            bot.execute_sell(grams)
                            time.sleep(15)

                            sell_value            = grams * price
                            profit                = sell_value - egp_in
                            state["total_profit"] += profit
                            state["trade_count"]  += 1
                            state["in_position"]   = False
                            state["buy_price"]     = None
                            state["grams_held"]    = None
                            state["egp_invested"]  = None
                            state["peak_price"]    = price

                            wallet = bot.get_wallet_balance() or sell_value
                            state["wallet_balance"] = wallet
                            save_state(state)

                            log_trade("SELL", price, sell_value, grams, profit, wallet)
                            email_sold(buy_price, price, grams, profit,
                                       wallet, state["trade_count"], state["total_profit"])

                            log.info(
                                f"✅ Trade #{state['trade_count']} | "
                                f"Profit: +{profit:.2f} EGP | "
                                f"Total: +{state['total_profit']:.2f} EGP"
                            )

                        elif change_pct < -2.0:
                            # Send holding update every 6 hours if deep in red
                            if time.time() - last_holding_alert > 21600:
                                email_holding_update(buy_price, price, grams, change_pct)
                                last_holding_alert = time.time()

                    # ── WATCHING FOR DIP ──────────────────────────────────
                    else:
                        # Update rolling peak
                        if state["peak_price"] is None or price > state["peak_price"]:
                            state["peak_price"] = price

                        peak    = state["peak_price"]
                        dip_pct = (peak - price) / peak * 100

                        log.info(
                            f"[WATCHING] {price:,.2f} EGP/g | "
                            f"Peak: {peak:,.2f} | "
                            f"Dip: {dip_pct:.2f}% (need {DIP_BUY_PCT}%)"
                        )

                        wallet = bot.get_wallet_balance()
                        if wallet is not None:
                            state["wallet_balance"] = wallet
                        else:
                            wallet = state.get("wallet_balance") or 0

                        if dip_pct >= DIP_BUY_PCT:
                            if wallet >= LOW_WALLET:
                                log.info(f"DIP {dip_pct:.2f}% — BUYING {wallet:,.2f} EGP")
                                bot.execute_buy(wallet)
                                time.sleep(10)

                                grams_bought          = wallet / price
                                state["in_position"]  = True
                                state["buy_price"]    = price
                                state["buy_time"]     = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                                state["grams_held"]   = grams_bought
                                state["egp_invested"] = wallet
                                state["wallet_balance"] = 0
                                state["peak_price"]   = price
                                save_state(state)

                                log_trade("BUY", price, wallet, grams_bought, 0, 0)
                                email_bought(price, grams_bought, wallet,
                                             state["trade_count"] + 1)

                            else:
                                log.info(f"DIP {dip_pct:.2f}% but wallet only {wallet:.2f} EGP")
                                if time.time() - last_add_funds_alert > 3600:
                                    email_add_funds(price, wallet, dip_pct, peak)
                                    last_add_funds_alert = time.time()

                    save_state(state)

                except PlaywrightTimeout:
                    log.warning("Timeout — retrying next cycle")
                except Exception as e:
                    log.error(f"Cycle error: {e}\n{traceback.format_exc()}")

                log.info(f"Sleeping {INTERVAL}s...\n")
                time.sleep(INTERVAL)

        except KeyboardInterrupt:
            log.info("Stopped manually")
        except Exception as e:
            err = traceback.format_exc()
            log.error(f"Fatal: {err}")
            email_error(err)
        finally:
            bot.close()


if __name__ == "__main__":
    run_bot()
