import { NextResponse } from "next/server";
import { getState, saveState } from "@/lib/redis";

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

  if (state.in_position && !state.peak_price && state.buy_price) {
    state.peak_price = state.buy_price;
  }

  await saveState(state);
  return NextResponse.json({ ok: true, state });
}

export async function GET() {
  const state = await getState();
  return NextResponse.json({ state });
}
