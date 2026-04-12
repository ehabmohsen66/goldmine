import { NextResponse } from "next/server";
import { getState, saveState, getRedis } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/bot/sync
 * Body: { grams_held, buy_price, wallet_balance }
 * Manually syncs the bot state with reality from the MNGM dashboard.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const state = await getState();

  if (body.grams_held !== undefined) {
    state.grams_held = parseFloat(body.grams_held);
    state.in_position = state.grams_held > 0;
  }
  if (body.buy_price !== undefined) state.buy_price = parseFloat(body.buy_price);
  if (body.wallet_balance !== undefined) state.wallet_balance = parseFloat(body.wallet_balance);
  if (body.egp_invested !== undefined) state.egp_invested = parseFloat(body.egp_invested);
  if (body.total_profit !== undefined) state.total_profit = parseFloat(body.total_profit);
  if (body.peak_price !== undefined) state.peak_price = parseFloat(body.peak_price);
  if (body.trailing_high !== undefined) state.trailing_high = parseFloat(body.trailing_high);
  if (body.trade_count !== undefined) state.trade_count = parseInt(body.trade_count);
  if (body.dca_level !== undefined) state.dca_level = parseInt(body.dca_level);

  if (state.in_position && !state.peak_price && state.buy_price) {
    state.peak_price = state.buy_price;
  }

  await saveState(state);

  // Also reset the wallet-fetch throttle so the next cron tick re-syncs immediately
  const r = getRedis();
  await r.del("goldmine:last_wallet_fetch");
  await r.del("goldmine:last_sell_signal"); // clear sell signal cooldown too

  return NextResponse.json({ ok: true, state, synced: true });
}

export async function GET() {
  const state = await getState();
  return NextResponse.json({ state });
}

/** DELETE /api/bot/sync — wipes the trade log */
export async function DELETE() {
  const { getRedis, KEYS } = await import("@/lib/redis");
  await getRedis().del(KEYS.TRADES);
  return NextResponse.json({ ok: true, message: "Trade log cleared" });
}
