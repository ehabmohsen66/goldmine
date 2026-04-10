import { NextResponse } from "next/server";
import { getTrades } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get("limit") ?? "50");
  const trades = await getTrades(Math.min(limit, 200));
  return NextResponse.json({ trades });
}
