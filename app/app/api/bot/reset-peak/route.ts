import { NextResponse } from "next/server";
import { getState, saveState, getRedis } from "@/lib/redis";

export const runtime = "nodejs";

/**
 * POST /api/bot/reset-peak
 * Manually resets the rolling peak price to the current live price.
 * Use when peak_price is stale (e.g. set months ago and gold has dropped since).
 */
export async function POST() {
  try {
    const state = await getState();

    if (state.last_price === null) {
      return NextResponse.json({ error: "No current price available — bot hasn't ticked yet" }, { status: 400 });
    }

    const oldPeak = state.peak_price;
    state.peak_price = state.last_price;
    await saveState(state);

    return NextResponse.json({
      ok: true,
      oldPeak,
      newPeak: state.last_price,
      message: `Peak reset from ${oldPeak?.toFixed(2)} → ${state.last_price.toFixed(2)} EGP/g`,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
