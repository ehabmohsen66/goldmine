/**
 * Telegram notification helper for Goldmine bot.
 * Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in Railway Variables.
 */

import type { EgxStock } from "./egx";

const BASE = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

async function send(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return; // silently skip if not configured
  try {
    await fetch(`${BASE}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
  } catch (e) {
    console.error("[telegram] Failed to send:", e);
  }
}

export async function telegramBuySignal(price: number, egpAmount: number, dipPct: number, wallet: number) {
  const grams = (egpAmount / price).toFixed(4);
  await send(
    `🟢 <b>BUY SIGNAL — Goldmine Bot</b>\n\n` +
    `📉 Gold dipped <b>${dipPct.toFixed(2)}%</b> from peak\n` +
    `💰 Current price: <b>${price.toFixed(2)} EGP/g</b>\n` +
    `💸 Recommended buy: <b>${egpAmount.toFixed(0)} EGP</b> (~${grams}g)\n` +
    `👛 Wallet available: <b>${wallet.toFixed(2)} EGP</b>\n\n` +
    `👆 <a href="https://mngm.com/buy/metals/fractional/8">Tap here to buy on MNGM</a>\n\n` +
    `<i>Reply /confirm_buy ${egpAmount.toFixed(0)} to log the trade</i>`
  );
}

export async function telegramSellSignal(buyPrice: number, currentPrice: number, grams: number, unrealizedProfit: number) {
  const profitPct = (((currentPrice - buyPrice) / buyPrice) * 100).toFixed(2);
  await send(
    `🔴 <b>SELL SIGNAL — Goldmine Bot</b>\n\n` +
    `📈 Gold up <b>${profitPct}%</b> from your buy price\n` +
    `💰 Current price: <b>${currentPrice.toFixed(2)} EGP/g</b>\n` +
    `📦 Your position: <b>${grams.toFixed(4)}g</b> (bought @ ${buyPrice.toFixed(2)})\n` +
    `💵 Unrealized profit: <b>+${unrealizedProfit.toFixed(2)} EGP</b>\n\n` +
    `👆 <a href="https://mngm.com/account">Tap here to sell on MNGM</a>\n\n` +
    `<i>Reply /confirm_sell to log the trade</i>`
  );
}

export async function telegramHoldAlert(buyPrice: number, currentPrice: number, changePct: number) {
  await send(
    `⚠️ <b>HOLDING ALERT — Goldmine Bot</b>\n\n` +
    `Gold is down <b>${Math.abs(changePct).toFixed(2)}%</b> from your buy\n` +
    `📊 Buy price: ${buyPrice.toFixed(2)} | Now: <b>${currentPrice.toFixed(2)} EGP/g</b>\n\n` +
    `<i>Bot is holding. Will alert when trail stop triggers.</i>`
  );
}

export async function telegramError(error: string) {
  await send(`❌ <b>Goldmine Error</b>\n\n<code>${error.slice(0, 500)}</code>`);
}

export async function telegramInfo(msg: string) {
  await send(`ℹ️ <b>Goldmine Bot</b>\n\n${msg}`);
}

// ─── EGX Egyptian Exchange Notifications ─────────────────────────────────────

function signalEmoji(signal: EgxStock["signal"]): string {
  switch (signal) {
    case "STRONG_BUY": return "🟢🟢";
    case "BUY":        return "🟢";
    case "HOLD":       return "🟡";
    case "SELL":       return "🔴";
    case "STRONG_SELL":return "🔴🔴";
  }
}

export async function telegramEgxBrief(brief: {
  topBuys: EgxStock[];
  topGainers: EgxStock[];
  topLosers: EgxStock[];
  watchlist: EgxStock[];
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  totalScanned: number;
}) {
  const now = new Date().toLocaleString("ar-EG", {
    timeZone: "Africa/Cairo",
    weekday: "long",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  const marketMood =
    brief.bullishCount > brief.bearishCount * 1.5 ? "🟢 سوق متفائل" :
    brief.bearishCount > brief.bullishCount * 1.5 ? "🔴 سوق متشائم" :
    "🟡 سوق محايد";

  // Section: Top Buy Signals
  let buysSection = "";
  if (brief.topBuys.length > 0) {
    buysSection = "\n\n📈 <b>أقوى إشارات الشراء:</b>\n";
    for (const s of brief.topBuys.slice(0, 5)) {
      const rsiStr = s.rsi !== null ? ` | RSI ${s.rsi.toFixed(0)}` : "";
      buysSection += `${signalEmoji(s.signal)} <b>${s.symbol}</b> — ${s.price.toFixed(2)} جنيه` +
        ` (${s.change >= 0 ? "+" : ""}${s.change.toFixed(2)}%)${rsiStr} | نقاط: ${s.score}/100\n`;
    }
  }

  // Section: Top Gainers
  let gainersSection = "";
  if (brief.topGainers.length > 0) {
    gainersSection = "\n\n🚀 <b>الأكثر ارتفاعاً اليوم:</b>\n";
    for (const s of brief.topGainers.slice(0, 5)) {
      gainersSection += `• <b>${s.symbol}</b> +${s.change.toFixed(2)}% | ${s.price.toFixed(2)} جنيه\n`;
    }
  }

  // Section: Top Losers
  let losersSection = "";
  if (brief.topLosers.length > 0) {
    losersSection = "\n\n📉 <b>الأكثر انخفاضاً:</b>\n";
    for (const s of brief.topLosers.slice(0, 3)) {
      losersSection += `• <b>${s.symbol}</b> ${s.change.toFixed(2)}% | ${s.price.toFixed(2)} جنيه\n`;
    }
  }

  // Section: Oversold Watchlist
  let watchSection = "";
  if (brief.watchlist.length > 0) {
    watchSection = "\n\n👀 <b>مراقبة (RSI منخفض — ارتداد محتمل):</b>\n";
    for (const s of brief.watchlist) {
      watchSection += `• <b>${s.symbol}</b> — RSI ${s.rsi?.toFixed(0)} | ${s.price.toFixed(2)} جنيه\n`;
    }
  }

  const msg =
    `📊 <b>تقرير البورصة المصرية — ${now}</b>\n` +
    `البورصة: ${marketMood}\n` +
    `📋 إجمالي الأسهم المحللة: ${brief.totalScanned} | ` +
    `🟢 ${brief.bullishCount} صاعد | 🟡 ${brief.neutralCount} محايد | 🔴 ${brief.bearishCount} هابط` +
    buysSection +
    gainersSection +
    losersSection +
    watchSection +
    `\n\n<i>تحليل تلقائي من TradingView — ليس نصيحة استثمارية</i>`;

  await send(msg);
}

/** 🟢 BUY alert — strong signal detected */
export async function telegramEgxBuyAlert(stock: EgxStock, reason: string) {
  const emoji = stock.signal === "STRONG_BUY" ? "🟢🟢" : "🟢";
  await send(
    `${emoji} <b>إشارة شراء — ${stock.symbol}</b>\n\n` +
    `📌 ${reason}\n\n` +
    `💰 السعر الحالي: <b>${stock.price.toFixed(2)} جنيه</b>\n` +
    `📊 التغيير اليوم: <b>${stock.change >= 0 ? "+" : ""}${stock.change.toFixed(2)}%</b>\n` +
    `🎯 الإشارة: <b>${stock.signal.replace("_", " ")}</b>\n` +
    `📈 النقاط: <b>${stock.score}/100</b>\n` +
    (stock.rsi !== null ? `💹 RSI: <b>${stock.rsi.toFixed(0)}</b>\n` : "") +
    (stock.macd !== null && stock.macdSignal !== null
      ? `📉 MACD: <b>${stock.macd > stock.macdSignal ? "تقاطع صاعد ✅" : "ضعيف"}</b>\n`
      : "") +
    `\n⚠️ <i>هذا تنبيه تلقائي وليس نصيحة استثمارية. السوق ينطوي على مخاطر.</i>\n` +
    `<i>سيصلك تنبيه بيع تلقائياً عند انعكاس الإشارة.</i>`
  );
}

/** 🔴 SELL alert — signal reversed */
export async function telegramEgxSellAlert(
  stock: EgxStock,
  alertPrice: number,
  priceDeltaPct: number,
  reason: string
) {
  const emoji = stock.signal === "STRONG_SELL" ? "🔴🔴" : "🔴";
  const profitStr = priceDeltaPct >= 0
    ? `✅ ربح محتمل من التنبيه: <b>+${priceDeltaPct.toFixed(2)}%</b>`
    : `⚠️ خسارة من التنبيه: <b>${priceDeltaPct.toFixed(2)}%</b>`;

  await send(
    `${emoji} <b>إشارة بيع — ${stock.symbol}</b>\n\n` +
    `📌 ${reason}\n\n` +
    `💰 السعر الحالي: <b>${stock.price.toFixed(2)} جنيه</b>\n` +
    `📥 سعر تنبيه الشراء: <b>${alertPrice.toFixed(2)} جنيه</b>\n` +
    `${profitStr}\n` +
    `📊 التغيير اليوم: <b>${stock.change >= 0 ? "+" : ""}${stock.change.toFixed(2)}%</b>\n` +
    `🎯 الإشارة: <b>${stock.signal.replace("_", " ")}</b>\n` +
    (stock.rsi !== null ? `💹 RSI: <b>${stock.rsi.toFixed(0)}</b>\n` : "") +
    `\n<i>تم حذف السهم من المحفظة التلقائية</i>`
  );
}

/** 👀 WATCH alert — oversold, potential bounce */
export async function telegramEgxWatchAlert(stock: EgxStock, reason: string) {
  await send(
    `👀 <b>مراقبة — ${stock.symbol}</b>\n\n` +
    `📌 ${reason}\n\n` +
    `💰 السعر: <b>${stock.price.toFixed(2)} جنيه</b>\n` +
    `📊 التغيير: <b>${stock.change >= 0 ? "+" : ""}${stock.change.toFixed(2)}%</b>\n` +
    (stock.rsi !== null ? `💹 RSI: <b>${stock.rsi.toFixed(0)}</b> (منطقة إفراط البيع)\n` : "") +
    `📈 النقاط: <b>${stock.score}/100</b>\n\n` +
    `<i>انتظر تأكيد الإشارة قبل الدخول</i>`
  );
}

