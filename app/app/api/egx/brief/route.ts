import { NextResponse } from "next/server";
import { getEgxDailyBrief } from "@/lib/egx";
import { getEgxAlerts, getEgxPortfolio, getRedis } from "@/lib/redis";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

/**
 * GET /api/egx/brief
 * Returns:
 *   - Live market overview (TradingView scan, 15-min cached)
 *   - Portfolio: stocks we've sent BUY alerts for
 *   - Alert history: last 50 BUY/SELL/WATCH alerts
 */
export async function GET() {
  const r = getRedis();
  const CACHE_KEY = "goldmine:egx_brief_cache";
  const CACHE_TTL_MS = 15 * 60 * 1000;

  try {
    // Fetch market overview (cached)
    let overview: Awaited<ReturnType<typeof getEgxDailyBrief>> | null = null;
    const cached = await r.get<{ data: typeof overview; ts: number }>(CACHE_KEY);

    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      overview = cached.data;
    } else {
      overview = await getEgxDailyBrief();
      await r.set(CACHE_KEY, { data: overview, ts: Date.now() }, { ex: 1200 });
    }

    // Fetch portfolio + alert history in parallel
    const [portfolio, alerts, lastScan] = await Promise.all([
      getEgxPortfolio(),
      getEgxAlerts(50),
      r.get<string>("egx:last_scan"),
    ]);

    return NextResponse.json({
      overview,
      portfolio,
      alerts,
      lastScan: lastScan ? new Date(parseInt(lastScan)).toISOString() : null,
      cachedAt: cached?.ts ?? Date.now(),
    });
  } catch (err) {
    // Return stale data on error
    try {
      const stale = await r.get<{ data: unknown; ts: number }>(CACHE_KEY);
      const [portfolio, alerts] = await Promise.all([getEgxPortfolio(), getEgxAlerts(50)]);
      if (stale) return NextResponse.json({ overview: stale.data, portfolio, alerts, stale: true });
    } catch { /* ignore */ }

    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
