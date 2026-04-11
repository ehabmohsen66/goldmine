/**
 * Telegram notification helper for Goldmine bot.
 * Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in Railway Variables.
 */

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
