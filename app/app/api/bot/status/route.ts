import { NextResponse } from "next/server";
import { getState, isBotEnabled, getPriceHistory } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [state, enabled, prices] = await Promise.all([
      getState(),
      isBotEnabled(),
      getPriceHistory(120),
    ]);

    return NextResponse.json({
      ...state,
      bot_enabled: enabled,
      price_history: prices,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
