import { NextResponse } from "next/server";
import { executeBuy, executeSell, loginAndGetWallet } from "@/lib/scraper";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/bot/test
 * Manually trigger a buy or sell for testing purposes.
 * Body: { action: "buy" | "sell" | "wallet", amount?: number }
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { action, amount } = body as { action: string; amount?: number };

  try {
    if (action === "telegram") {
      const token = process.env.TELEGRAM_BOT_TOKEN;
      const chatId = process.env.TELEGRAM_CHAT_ID;
      if (!token || !chatId) return NextResponse.json({ error: "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set in Railway Variables" });
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: "✅ <b>Goldmine Telegram test — working!</b>", parse_mode: "HTML" }),
      });
      const result = await res.json();
      return NextResponse.json({ ok: res.ok, telegram_response: result });
    }

    if (action === "wallet") {
      const balance = await loginAndGetWallet();
      return NextResponse.json({ ok: true, action, wallet_balance: balance });
    }

    if (action === "buy") {
      const egp = amount ?? 50;
      console.log(`[test] Manual BUY triggered — ${egp} EGP`);
      const success = await executeBuy(egp);
      return NextResponse.json({ ok: success, action, egp_amount: egp });
    }

    if (action === "sell") {
      const grams = amount ?? 0.001;
      console.log(`[test] Manual SELL triggered — ${grams}g`);
      const success = await executeSell(grams);
      return NextResponse.json({ ok: success, action, grams });
    }

    return NextResponse.json({ error: "action must be: buy | sell | wallet" }, { status: 400 });

  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
