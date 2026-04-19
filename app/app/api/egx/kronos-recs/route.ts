import { NextResponse } from "next/server";
import { getKronosHistory, type KronosPredictionRecord } from "@/lib/redis";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/egx/kronos-recs
 *
 * Aggregates Kronos prediction history into ranked buy recommendations:
 * - Latest bullish prediction per symbol
 * - Live price vs predicted target
 * - Conviction score based on upside % + past accuracy per symbol
 * - Ranked from highest to lowest conviction
 */
export async function GET() {
  try {
    const history = await getKronosHistory(200);

    if (!history.length) {
      return NextResponse.json({ recommendations: [], stats: { totalSymbols: 0 } });
    }

    // ── 1. Group by symbol, keep only the LATEST prediction per symbol ────────
    const latestBySymbol = new Map<string, KronosPredictionRecord>();
    for (const record of history) {
      const existing = latestBySymbol.get(record.symbol);
      if (!existing || new Date(record.predictedAt) > new Date(existing.predictedAt)) {
        latestBySymbol.set(record.symbol, record);
      }
    }

    // ── 2. Keep only bullish predictions ─────────────────────────────────────
    const bullish = Array.from(latestBySymbol.values()).filter(
      (r) => r.predictedChangePercent > 0
    );

    if (!bullish.length) {
      return NextResponse.json({ recommendations: [], stats: { totalSymbols: latestBySymbol.size } });
    }

    // ── 3. Compute per-symbol accuracy from history ───────────────────────────
    const accuracyBySymbol = new Map<string, { correct: number; total: number }>();
    for (const record of history) {
      if (record.directionCorrect === undefined) continue;
      const acc = accuracyBySymbol.get(record.symbol) ?? { correct: 0, total: 0 };
      acc.total += 1;
      if (record.directionCorrect) acc.correct += 1;
      accuracyBySymbol.set(record.symbol, acc);
    }

    // ── 4. Fetch current prices from Yahoo Finance ────────────────────────────
    const priceMap = new Map<string, { price: number; change: number }>();

    await Promise.all(
      bullish.map(async (rec) => {
        try {
          const yahooSym = `${rec.symbol}.CA`;
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSym}?interval=1d&range=5d`;
          const res = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
          });
          if (!res.ok) return;
          const data = await res.json();
          const result = data.chart?.result?.[0];
          if (!result) return;
          const closes: number[] = (result.indicators?.quote?.[0]?.close ?? []).filter(
            (c: number | null) => c !== null
          );
          if (closes.length < 2) return;
          const price = closes[closes.length - 1];
          const prevClose = closes[closes.length - 2];
          const change = ((price - prevClose) / prevClose) * 100;
          priceMap.set(rec.symbol, { price, change });
        } catch {
          /* skip */
        }
      })
    );

    // ── 5. Build recommendation objects ──────────────────────────────────────
    const recs = bullish.map((rec) => {
      const live = priceMap.get(rec.symbol);
      const livePrice = live?.price ?? null;
      const dayChange = live?.change ?? null;

      // Remaining upside from current price to Kronos target
      const remainingUpside =
        livePrice !== null
          ? ((rec.predictedEndPrice - livePrice) / livePrice) * 100
          : rec.predictedChangePercent;

      // Accuracy bonus: per-symbol track record
      const symAcc = accuracyBySymbol.get(rec.symbol);
      const accuracyBonus = symAcc && symAcc.total >= 2
        ? (symAcc.correct / symAcc.total) * 20  // up to +20 points
        : 10; // neutral bonus for new symbols

      // Freshness: predictions older than 30 days lose confidence
      const agedays = (Date.now() - new Date(rec.predictedAt).getTime()) / (1000 * 60 * 60 * 24);
      const freshnessScore = Math.max(0, 100 - agedays * 2); // decay 2pts/day

      // Entry quality: is current price a good entry vs prediction price?
      // If live price < prediction price it's actually a better entry
      const entryBonus =
        livePrice !== null && livePrice <= rec.priceAtPrediction ? 10 : 0;

      // Conviction = weighted score
      const conviction = Math.min(
        100,
        Math.round(
          remainingUpside * 1.5 +   // upside magnitude (main driver)
          accuracyBonus +            // track record
          freshnessScore * 0.2 +     // freshness
          entryBonus                 // entry quality
        )
      );

      return {
        symbol: rec.symbol,
        predictedAt: rec.predictedAt,
        priceAtPrediction: rec.priceAtPrediction,
        predictedEndPrice: rec.predictedEndPrice,
        predictedChangePercent: rec.predictedChangePercent,
        predictedHigh: rec.predictedHigh,
        predictedLow: rec.predictedLow,
        predictionDays: rec.predictionDays,
        livePrice,
        dayChange,
        remainingUpside: parseFloat(remainingUpside.toFixed(2)),
        conviction: Math.max(0, conviction),
        accuracyRecord: symAcc ?? null,
        ageDays: Math.floor(agedays),
        // Recommendation strength
        strength:
          conviction >= 60 ? "STRONG_BUY" :
          conviction >= 35 ? "BUY" :
          "WATCH",
      };
    });

    // ── 6. Sort by conviction descending ─────────────────────────────────────
    recs.sort((a, b) => b.conviction - a.conviction);

    return NextResponse.json({
      recommendations: recs,
      stats: {
        totalSymbols: latestBySymbol.size,
        bullishCount: bullish.length,
        strongBuyCount: recs.filter((r) => r.strength === "STRONG_BUY").length,
        buyCount: recs.filter((r) => r.strength === "BUY").length,
        watchCount: recs.filter((r) => r.strength === "WATCH").length,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    console.error("Kronos Recs Error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
