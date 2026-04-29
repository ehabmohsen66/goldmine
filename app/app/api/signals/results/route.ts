import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";

export const runtime = "nodejs";
export const maxDuration = 60;

const PICKS_HISTORY_KEY = "signals:picks_history"; // list of daily snapshots

export interface DailyPickResult {
  id: string;
  date: string;             // YYYY-MM-DD
  symbol: string;
  name: string;
  type: "EGX" | "GOLD";
  entryPrice: number;       // price when pick was made
  exitPrice: number | null; // next-day actual price
  change: number | null;    // actual % change
  signal: string;           // what we predicted
  predictedUp: boolean;     // did we predict price would rise?
  correct: boolean | null;  // null = not yet checked
  scoreAtPick: number;
  reason: string;
}

export interface DailySnapshot {
  date: string;
  picks: DailyPickResult[];
  stats: {
    total: number;
    correct: number;
    incorrect: number;
    pending: number;
    accuracy: number | null;
    avgGain: number | null;
  };
}

/** Fetch current price from Yahoo Finance */
async function fetchCurrentPrice(symbol: string, isGold: boolean): Promise<{ current: number; prev: number } | null> {
  try {
    const yahooSym = isGold ? "GC=F" : `${symbol}.CA`;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSym}?interval=1d&range=5d`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const closes: number[] = (data.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? []).filter((c: number | null) => c !== null);
    if (closes.length < 2) return null;
    return {
      current: closes[closes.length - 1],
      prev: closes[closes.length - 2],
    };
  } catch {
    return null;
  }
}

/** 
 * GET /api/signals/results
 * Returns historical daily pick results with accuracy tracking.
 * Automatically settles yesterday's picks by fetching current prices.
 */
export async function GET() {
  try {
    const r = getRedis();
    const raw = await r.lrange(PICKS_HISTORY_KEY, 0, 29); // last 30 days
    const snapshots: DailySnapshot[] = raw.map(item =>
      typeof item === "string" ? JSON.parse(item) : item
    );

    // Find any snapshots with pending picks older than 20 hours and settle them
    const now = Date.now();
    const settled: DailySnapshot[] = [];
    let anyUpdated = false;

    for (const snapshot of snapshots) {
      const snapshotAge = now - new Date(snapshot.date).getTime();
      const isOldEnough = snapshotAge > 20 * 60 * 60 * 1000; // 20 hours
      const hasPending = snapshot.picks.some(p => p.correct === null);

      if (!hasPending || !isOldEnough) {
        settled.push(snapshot);
        continue;
      }

      // Settle pending picks
      const pendingSymbols = [...new Set(
        snapshot.picks.filter(p => p.correct === null).map(p => p.symbol)
      )];

      const priceMap = new Map<string, { current: number; prev: number }>();
      await Promise.all(
        pendingSymbols.map(async sym => {
          const isGold = sym === "XAU";
          const prices = await fetchCurrentPrice(sym, isGold);
          if (prices) priceMap.set(sym, prices);
        })
      );

      const updatedPicks = snapshot.picks.map(pick => {
        if (pick.correct !== null) return pick;
        const prices = priceMap.get(pick.symbol);
        if (!prices) return pick;

        const exitPrice = prices.prev; // use yesterday's confirmed close
        const changePct = ((exitPrice - pick.entryPrice) / pick.entryPrice) * 100;
        const correct = pick.predictedUp ? changePct >= 0 : changePct < 0;

        return {
          ...pick,
          exitPrice: +exitPrice.toFixed(3),
          change: +changePct.toFixed(2),
          correct,
        };
      });

      // Recompute stats
      const settled_picks = updatedPicks.filter(p => p.correct !== null);
      const correct_count = settled_picks.filter(p => p.correct === true).length;
      const pending_count = updatedPicks.filter(p => p.correct === null).length;
      const gains = settled_picks.map(p => p.change ?? 0);
      const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / gains.length : null;

      const updatedSnapshot: DailySnapshot = {
        ...snapshot,
        picks: updatedPicks,
        stats: {
          total: updatedPicks.length,
          correct: correct_count,
          incorrect: settled_picks.length - correct_count,
          pending: pending_count,
          accuracy: settled_picks.length > 0 ? Math.round((correct_count / settled_picks.length) * 100) : null,
          avgGain: avgGain !== null ? +avgGain.toFixed(2) : null,
        },
      };

      settled.push(updatedSnapshot);
      anyUpdated = true;
    }

    // If we updated any snapshots, rewrite the list in Redis
    if (anyUpdated) {
      const pipeline = r.pipeline();
      pipeline.del(PICKS_HISTORY_KEY);
      for (const snap of [...settled].reverse()) {
        pipeline.lpush(PICKS_HISTORY_KEY, JSON.stringify(snap));
      }
      pipeline.ltrim(PICKS_HISTORY_KEY, 0, 29);
      await pipeline.exec();
    }

    // Overall accuracy across all history
    const allPicks = settled.flatMap(s => s.picks).filter(p => p.correct !== null);
    const totalCorrect = allPicks.filter(p => p.correct === true).length;
    const totalChecked = allPicks.length;
    const overallAccuracy = totalChecked > 0 ? Math.round((totalCorrect / totalChecked) * 100) : null;

    const allGains = allPicks.map(p => p.change ?? 0);
    const overallAvgGain = allGains.length > 0
      ? +(allGains.reduce((a, b) => a + b, 0) / allGains.length).toFixed(2)
      : null;

    return NextResponse.json({
      snapshots: settled,
      overall: {
        totalDays: settled.length,
        totalPredictions: allPicks.length,
        correct: totalCorrect,
        accuracy: overallAccuracy,
        avgGainPct: overallAvgGain,
      },
    });
  } catch (err: any) {
    console.error("[signals/results] Error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * POST /api/signals/results
 * Called by the cron job to save today's picks as a new daily snapshot.
 * Should be called once per day (ideally at market open).
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { picks, date } = body;

    if (!picks || !Array.isArray(picks)) {
      return NextResponse.json({ error: "picks array required" }, { status: 400 });
    }

    const r = getRedis();
    const today = date || new Date().toISOString().split("T")[0];

    // Check if we already have a snapshot for today
    const raw = await r.lrange(PICKS_HISTORY_KEY, 0, 0);
    if (raw.length > 0) {
      const latest: DailySnapshot = typeof raw[0] === "string" ? JSON.parse(raw[0]) : raw[0];
      if (latest.date === today) {
        return NextResponse.json({ skipped: true, reason: "Already saved today's snapshot" });
      }
    }

    // Build the new snapshot
    const pickResults: DailyPickResult[] = picks.map((p: any) => ({
      id: `${today}-${p.symbol}`,
      date: today,
      symbol: p.symbol,
      name: p.name,
      type: p.type,
      entryPrice: p.price,
      exitPrice: null,
      change: null,
      signal: p.signal,
      predictedUp: p.signal === "STRONG_BUY" || p.signal === "BUY",
      correct: null,
      scoreAtPick: p.score,
      reason: p.reason,
    }));

    const snapshot: DailySnapshot = {
      date: today,
      picks: pickResults,
      stats: {
        total: pickResults.length,
        correct: 0,
        incorrect: 0,
        pending: pickResults.length,
        accuracy: null,
        avgGain: null,
      },
    };

    const rr = getRedis();
    await rr.lpush(PICKS_HISTORY_KEY, JSON.stringify(snapshot));
    await rr.ltrim(PICKS_HISTORY_KEY, 0, 29); // keep 30 days

    return NextResponse.json({ ok: true, date: today, saved: pickResults.length });
  } catch (err: any) {
    console.error("[signals/results POST] Error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
