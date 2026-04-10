import { NextResponse } from "next/server";
import { setBotEnabled, getState, saveState } from "@/lib/redis";

export const runtime = "nodejs";

export async function POST() {
  await setBotEnabled(true);
  const state = await getState();
  state.status = "running";
  state.last_error = null;
  await saveState(state);
  return NextResponse.json({ ok: true, message: "Bot started" });
}
