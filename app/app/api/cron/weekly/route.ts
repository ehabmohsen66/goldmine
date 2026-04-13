import { NextResponse } from "next/server";
import { getRedis, getTrades, getEgxAlerts, KEYS } from "@/lib/redis";
import { getState } from "@/lib/redis";

export const runtime = "nodejs";
export const maxDuration = 30;

const CRON_SECRET = process.env.CRON_SECRET;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID   = process.env.TELEGRAM_CHAT_ID;

async function send(text: string) {
  if (!BOT_TOKEN || !CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: "HTML" }),
  });
}

/**
 * GET /api/cron/weekly
 * Sends a comprehensive weekly performance report via Telegram.
 * Schedule in Railway to run every Sunday at 18:00 Cairo time.
 * Add ?force=1 to test immediately.
 */
export async function GET(req: Request) {
  if (CRON_SECRET) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const url = new URL(req.url);
  const forced = url.searchParams.get("force") === "1";

  const r = getRedis();
  const LAST_WEEKLY_KEY = "goldmine:last_weekly_report";

  // Rate-limit: only once per 6 days (unless forced)
  if (!forced) {
    const last = await r.get<string>(LAST_WEEKLY_KEY);
    if (last && Date.now() - parseInt(last) < 6 * 24 * 3600 * 1000) {
      return NextResponse.json({ skipped: true, reason: "Already sent this week" });
    }
  }

  try {
    const [state, trades, egxAlerts] = await Promise.all([
      getState(),
      getTrades(100),
      getEgxAlerts(200),
    ]);

    // ── Gold Bot Stats ──────────────────────────────────────────────────────
    const oneWeekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const weekTrades = trades.filter(t => new Date(t.timestamp).getTime() > oneWeekAgo);
    const weekSells  = weekTrades.filter(t => t.action === "SELL");
    const weekProfit = weekSells.reduce((s, t) => s + (t.profit ?? 0), 0);
    const winTrades  = weekSells.filter(t => t.profit > 0).length;
    const winRate    = weekSells.length > 0 ? Math.round((winTrades / weekSells.length) * 100) : 0;

    // ── EGX Signal Accuracy ─────────────────────────────────────────────────
    const weekEgxAlerts = egxAlerts.filter(a => new Date(a.timestamp).getTime() > oneWeekAgo);
    const egxBuys  = weekEgxAlerts.filter(a => a.action === "BUY").length;
    const egxSells = weekEgxAlerts.filter(a => a.action === "SELL").length;
    const egxWatch = weekEgxAlerts.filter(a => a.action === "WATCH").length;

    const now = new Date().toLocaleDateString("ar-EG", {
      timeZone: "Africa/Cairo", weekday: "long", day: "numeric", month: "long",
    });

    const goldSection =
      `🥇 <b>بوت الذهب (MNGM)</b>\n` +
      `📊 الصفقات هذا الأسبوع: <b>${weekSells.length}</b>\n` +
      `💰 صافي الربح: <b>${weekProfit >= 0 ? "+" : ""}${weekProfit.toFixed(2)} EGP</b>\n` +
      `🎯 نسبة النجاح: <b>${winRate}%</b> (${winTrades}/${weekSells.length})\n` +
      `💹 إجمالي الأرباح الكلية: <b>${state.total_profit?.toFixed(2) ?? 0} EGP</b>\n` +
      `👛 الرصيد الحالي: <b>${state.wallet_balance?.toFixed(2) ?? "—"} EGP</b>`;

    const egxSection =
      `\n\n📈 <b>البورصة المصرية (EGX)</b>\n` +
      `🟢 إشارات شراء أُرسلت: <b>${egxBuys}</b>\n` +
      `🔴 إشارات بيع أُرسلت: <b>${egxSells}</b>\n` +
      `👀 إشارات مراقبة: <b>${egxWatch}</b>\n` +
      `📋 إجمالي التنبيهات: <b>${weekEgxAlerts.length}</b>`;

    const msg =
      `📅 <b>التقرير الأسبوعي — ${now}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      goldSection +
      egxSection +
      `\n\n<i>تقرير تلقائي من Goldmine · كل أحد مساءً</i>`;

    await send(msg);
    await r.set(LAST_WEEKLY_KEY, String(Date.now()));

    return NextResponse.json({
      ok: true,
      weekProfit,
      weekTrades: weekSells.length,
      winRate,
      egxAlertsSent: weekEgxAlerts.length,
    });
  } catch (err) {
    console.error("[weekly-cron] Error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
