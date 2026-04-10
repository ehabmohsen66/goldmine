import { NextResponse } from "next/server";
import { setBotEnabled, getState, saveState } from "@/lib/redis";

export const runtime = "nodejs";

export async function POST() {
  await setBotEnabled(false);
  const state = await getState();
  state.status = "stopped";
  await saveState(state);
  return NextResponse.json({ ok: true, message: "Bot stopped" });
}
