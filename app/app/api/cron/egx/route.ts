import { NextResponse } from "next/server";
import { scanAllEgx, isMarketOpen, getEgxDailyBrief, type EgxStock } from "@/lib/egx";
import {
  telegramEgxBrief,
  telegramEgxBuyAlert,
  telegramEgxSellAlert,
  telegramEgxWatchAlert,
} from "@/lib/telegram";
import {
  getRedis, logEgxAlert, saveEgxPosition, removeEgxPosition,
  getEgxPortfolio, isInEgxPortfolio, setEgxCooldown, isEgxOnCooldown, KEYS,
} from "@/lib/redis";

export const runtime = "nodejs";
export const maxDuration = 55;

const CRON_SECRET = process.env.CRON_SECRET;

// ── Thresholds ────────────────────────────────────────────────────────────────
const BUY_SCORE_THRESHOLD  = parseInt(process.env.EGX_BUY_SCORE  ?? "68"); // min score to send BUY
const SELL_SCORE_THRESHOLD = parseInt(process.env.EGX_SELL_SCORE ?? "35"); // max score to send SELL
const WATCH_RSI_THRESHOLD  = parseInt(process.env.EGX_WATCH_RSI  ?? "32"); // RSI below this → WATCH
const BUY_COOLDOWN_H       = parseInt(process.env.EGX_BUY_CD_H   ?? "8");  // hours between BUY alerts per stock
const SELL_COOLDOWN_H      = parseInt(process.env.EGX_SELL_CD_H  ?? "4");  // hours between SELL alerts per stock
const MORNING_BRIEF_HOUR   = parseInt(process.env.EGX_BRIEF_HOUR ?? "10"); // hour to send daily brief (Cairo)

/**
 * GET /api/cron/egx
 *
 * **Automatic EGX alert engine** — called every 30 min by the internal scheduler.
 * Logic:
 *   1. Morning brief (once daily at 10 AM Cairo) — market overview
 *   2. BUY alerts  — stocks with score ≥ threshold not already in portfolio
 *   3. SELL alerts — portfolio stocks that have now reversed (score ≤ threshold)
 *   4. WATCH alerts — stocks with RSI < threshold (oversold, bounce potential)
 *
 * Add ?force=1 to bypass market-hours check (useful for testing).
 */
export async function GET(request: Request) {
  if (CRON_SECRET) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const url = new URL(request.url);
  const forced = url.searchParams.get("force") === "1";
  const briefOnly = url.searchParams.get("brief") === "1";

  const r = getRedis();
  const now = Date.now();
  const cairoNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Africa/Cairo" }));
  const cairoHour = cairoNow.getHours();
  const cairoMin  = cairoNow.getMinutes();

  // ── Step 0: Morning brief (once per day at EGX_BRIEF_HOUR) ──────────────
  const lastBriefKey = "egx:last_brief";
  const lastBrief    = await r.get<string>(lastBriefKey);
  const briefAgeH    = lastBrief ? (now - parseInt(lastBrief)) / 3600000 : Infinity;
  const isBriefTime  = cairoHour === MORNING_BRIEF_HOUR && cairoMin < 10;

  if ((isBriefTime && briefAgeH > 12) || (forced && briefOnly)) {
    try {
      console.log("[egx] 📊 Sending morning brief...");
      const brief = await getEgxDailyBrief();
      await telegramEgxBrief(brief);
      await r.set(lastBriefKey, String(now));
      if (briefOnly) return NextResponse.json({ ok: true, action: "brief_sent" });
    } catch (err) {
      console.error("[egx] Brief failed:", err);
    }
  }

  // ── Step 1: Skip scanning if market is closed (unless forced) ────────────
  const marketOpen = isMarketOpen();
  if (!marketOpen && !forced) {
    return NextResponse.json({ skipped: true, reason: "Market closed", marketOpen: false });
  }

  // Rate-limit scans to once every 25 min (scheduler calls every 30 min, buffer for drift)
  const lastScan = await r.get<string>(KEYS.EGX_LAST_SCAN);
  const scanAgeMin = lastScan ? (now - parseInt(lastScan)) / 60000 : Infinity;
  if (!forced && scanAgeMin < 25) {
    return NextResponse.json({ skipped: true, reason: `Rate-limited — next scan in ${Math.ceil(25 - scanAgeMin)}m` });
  }

  // ── Step 2: Fetch all EGX stocks ─────────────────────────────────────────
  console.log("[egx] 🔍 Scanning EGX market...");
  const stocks = await scanAllEgx(250);
  await r.set(KEYS.EGX_LAST_SCAN, String(now));

  const portfolio = await getEgxPortfolio();
  const portfolioMap = new Map(portfolio.map(p => [p.symbol, p]));

  const buyAlertsSent: string[] = [];
  const sellAlertsSent: string[] = [];
  const watchAlertsSent: string[] = [];

  // ── Step 3: Process each stock ────────────────────────────────────────────
  for (const stock of stocks) {
    const inPortfolio  = portfolioMap.has(stock.symbol);
    const onCooldown   = await isEgxOnCooldown(stock.symbol);

    // ── BUY alert: strong signal, not in portfolio, not in cooldown ──────
    if (
      !inPortfolio && !onCooldown &&
      stock.score >= BUY_SCORE_THRESHOLD &&
      (stock.signal === "BUY" || stock.signal === "STRONG_BUY")
    ) {
      const reason = buildBuyReason(stock);
      await telegramEgxBuyAlert(stock, reason);
      await logEgxAlert({
        timestamp: new Date().toISOString(),
        symbol: stock.symbol, name: stock.name,
        action: "BUY", price: stock.price, change: stock.change,
        rsi: stock.rsi, score: stock.score, signal: stock.signal, reason,
      });
      await saveEgxPosition({
        symbol: stock.symbol, name: stock.name,
        alertedAt: new Date().toISOString(),
        alertPrice: stock.price, lastScore: stock.score,
        lastSignal: stock.signal, lastCheckedAt: new Date().toISOString(),
      });
      await setEgxCooldown(stock.symbol, BUY_COOLDOWN_H * 3600);
      buyAlertsSent.push(stock.symbol);
      continue; // don't also check sell for same stock
    }

    // ── SELL alert: in portfolio and signal reversed ──────────────────────
    if (inPortfolio && !onCooldown) {
      const pos = portfolioMap.get(stock.symbol)!;
      const priceDelta = ((stock.price - pos.alertPrice) / pos.alertPrice) * 100;
      const shouldSell = stock.score <= SELL_SCORE_THRESHOLD ||
        stock.signal === "SELL" || stock.signal === "STRONG_SELL";

      if (shouldSell) {
        const reason = buildSellReason(stock, pos.alertPrice, priceDelta);
        await telegramEgxSellAlert(stock, pos.alertPrice, priceDelta, reason);
        await logEgxAlert({
          timestamp: new Date().toISOString(),
          symbol: stock.symbol, name: stock.name,
          action: "SELL", price: stock.price, change: stock.change,
          rsi: stock.rsi, score: stock.score, signal: stock.signal, reason,
        });
        await removeEgxPosition(stock.symbol);
        await setEgxCooldown(stock.symbol, SELL_COOLDOWN_H * 3600);
        sellAlertsSent.push(stock.symbol);
      } else {
        // Still holding — update metadata
        await saveEgxPosition({
          ...pos,
          lastScore: stock.score,
          lastSignal: stock.signal,
          lastCheckedAt: new Date().toISOString(),
        });
      }
      continue;
    }

    // ── WATCH alert: RSI oversold, not in portfolio, not in cooldown ──────
    if (
      !inPortfolio && !onCooldown &&
      stock.rsi !== null && stock.rsi < WATCH_RSI_THRESHOLD &&
      stock.change > -4 // not in free-fall
    ) {
      const reason = `RSI ${stock.rsi.toFixed(0)} — إفراط في البيع، ارتداد محتمل`;
      await telegramEgxWatchAlert(stock, reason);
      await logEgxAlert({
        timestamp: new Date().toISOString(),
        symbol: stock.symbol, name: stock.name,
        action: "WATCH", price: stock.price, change: stock.change,
        rsi: stock.rsi, score: stock.score, signal: stock.signal, reason,
      });
      await setEgxCooldown(stock.symbol, 6 * 3600); // 6h cooldown for watch alerts
      watchAlertsSent.push(stock.symbol);
    }
  }

  const summary = {
    ok: true,
    marketOpen,
    scanned: stocks.length,
    portfolioSize: portfolioMap.size,
    buyAlerts: buyAlertsSent,
    sellAlerts: sellAlertsSent,
    watchAlerts: watchAlertsSent,
    ts: new Date().toISOString(),
  };

  console.log(`[egx] ✓ Scan done — BUY: ${buyAlertsSent.length}, SELL: ${sellAlertsSent.length}, WATCH: ${watchAlertsSent.length}`);
  return NextResponse.json(summary);
}

// ── Alert reason builders ──────────────────────────────────────────────────────

function buildBuyReason(s: EgxStock): string {
  const parts: string[] = [];
  if (s.signal === "STRONG_BUY") parts.push("إشارة شراء قوية جداً من TradingView");
  else parts.push("إشارة شراء من TradingView");
  if (s.rsi !== null && s.rsi < 40) parts.push(`RSI ${s.rsi.toFixed(0)} منطقة شراء`);
  if (s.macd !== null && s.macdSignal !== null && s.macd > s.macdSignal) parts.push("MACD تقاطع صاعد");
  if (s.ema20 !== null && s.ema50 !== null && s.ema20 > s.ema50) parts.push("المتوسط 20 فوق 50");
  if (s.change > 1.5) parts.push(`ارتفاع ${s.change.toFixed(1)}% اليوم`);
  return parts.join(" · ");
}

function buildSellReason(s: EgxStock, alertPrice: number, priceDelta: number): string {
  const parts: string[] = [];
  if (s.signal === "STRONG_SELL") parts.push("إشارة بيع قوية جداً");
  else parts.push("إشارة البيع اشتعلت");
  if (priceDelta > 0) parts.push(`الربح من تنبيهنا: +${priceDelta.toFixed(2)}%`);
  else if (priceDelta < 0) parts.push(`تراجع ${priceDelta.toFixed(2)}% عن سعر التنبيه`);
  if (s.rsi !== null && s.rsi > 65) parts.push(`RSI ${s.rsi.toFixed(0)} منطقة تشبع شراء`);
  if (s.macd !== null && s.macdSignal !== null && s.macd < s.macdSignal) parts.push("MACD تقاطع هابط");
  return parts.join(" · ");
}
