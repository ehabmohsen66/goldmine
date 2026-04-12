import { NextResponse } from "next/server";
import { getState, saveState, logTrade, getRedis, KEYS } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/bot/confirm
 * Call this AFTER you manually execute a buy or sell on MNGM.
 * Body: { action: "buy" | "sell", price, grams, egp_amount, wallet_balance }
 *
 * This updates the bot state and logs the trade correctly.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { action, price, grams, egp_amount, wallet_balance } = body as {
    action: "buy" | "sell";
    price: number;
    grams: number;
    egp_amount: number;
    wallet_balance: number;
  };

  if (!action || !price || !grams) {
    return NextResponse.json({ error: "Required: action, price, grams" }, { status: 400 });
  }

  const state = await getState();

  if (action === "buy") {
    const prev_grams = state.grams_held ?? 0;
    const prev_invested = state.egp_invested ?? 0;

    state.in_position = true;
    state.buy_price = state.buy_price
      ? (state.buy_price * prev_grams + price * grams) / (prev_grams + grams)
      : price;
    state.grams_held = prev_grams + grams;
    state.egp_invested = prev_invested + egp_amount;
    state.trailing_high = price;
    state.peak_price = state.peak_price ? Math.max(state.peak_price, price) : price;
    state.buy_time = state.buy_time ?? new Date().toISOString();
    state.dca_level = (state.dca_level ?? 0) + 1;
    state.wallet_balance = wallet_balance ?? Math.max(0, (state.wallet_balance ?? 0) - egp_amount);

    await saveState(state);
    await logTrade({ timestamp: new Date().toISOString(), action: "BUY", price, egp_amount, grams, profit: 0, wallet_balance: state.wallet_balance });
    // Clear the pending buy signal
    await getRedis().del("goldmine:pending_buy");

    return NextResponse.json({ ok: true, action: "buy", state });
  }

  if (action === "sell") {
    const profit = (price - (state.buy_price ?? price)) * (state.grams_held ?? grams);
    const sell_value = grams * price;

    state.total_profit = (state.total_profit ?? 0) + profit;
    state.trade_count = (state.trade_count ?? 0) + 1;
    state.in_position = false;
    state.peak_price = price;
    state.trailing_high = null;
    state.dca_level = 0;
    state.dca_reserved = 0;
    state.buy_price = null;
    state.grams_held = null;
    state.egp_invested = null;
    state.buy_time = null;
    state.wallet_balance = wallet_balance ?? (state.wallet_balance ?? 0) + sell_value;

    await saveState(state);
    await logTrade({ timestamp: new Date().toISOString(), action: "SELL", price, egp_amount: sell_value, grams, profit, wallet_balance: state.wallet_balance });

    // ── Guard: prevent the cron tick auto-sync from logging a 2nd SELL ────────
    const r = getRedis();
    await r.set("goldmine:sell_confirmed", "1", { ex: 300 }); // expires in 5 min
    await r.del("goldmine:last_sell_signal");  // clear cooldown
    await r.del("goldmine:last_wallet_fetch"); // force immediate portfolio re-sync

    return NextResponse.json({ ok: true, action: "sell", profit, state });
  }

  return NextResponse.json({ error: "action must be buy or sell" }, { status: 400 });
}
