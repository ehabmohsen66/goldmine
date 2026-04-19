import { NextResponse } from "next/server";
import { getKronosHistory, updateKronosPrediction, type KronosPredictionRecord } from "@/lib/redis";

export const runtime = "nodejs";
export const maxDuration = 60; // may fetch many Yahoo prices for settlement

/**
 * GET /api/egx/kronos-history
 * Returns all Kronos prediction records, enriched with actual prices from Yahoo.
 * Automatically checks current prices for predictions that haven't been verified yet.
 */
export async function GET() {
  try {
    // Fetch recent 500 — we store up to 1000 but only need recent for settlement checks
    const history = await getKronosHistory(500);

    // Find predictions that need actual price checks:
    // For 1-day predictions: wait at least 1 full day before settling
    const unchecked = history.filter(
      (h) => !h.checkedAt && Date.now() - new Date(h.predictedAt).getTime() > 20 * 60 * 60 * 1000 // 20h min
    );

    // Batch unique symbols to check
    const symbolsToCheck = [...new Set(unchecked.map((h) => h.symbol))];

    // Fetch current prices for unchecked symbols
    const priceMap: Record<string, number> = {};
    await Promise.all(
      symbolsToCheck.map(async (symbol) => {
        try {
          const yahooSymbol = `${symbol}.CA`;
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1d&range=5d`;
          const res = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
            signal: AbortSignal.timeout(10000),
          });
          if (res.ok) {
            const data = await res.json();
            const quotes = data.chart?.result?.[0]?.indicators?.quote?.[0];
            const closes: number[] = quotes?.close?.filter((c: number | null) => c !== null) ?? [];
            // Bug fix: use second-to-last close (yesterday's confirmed close) for 1-day predictions
            // Consistent with paper-trades settlement logic
            if (closes.length >= 2) {
              priceMap[symbol] = closes[closes.length - 2];
            } else if (closes.length === 1) {
              priceMap[symbol] = closes[0];
            }
          }
        } catch {
          /* skip failed fetches */
        }
      })
    );

    // Update unchecked records with actual prices
    for (const record of unchecked) {
      const actualPrice = priceMap[record.symbol];
      if (actualPrice !== undefined) {
        const actualChangePct =
          ((actualPrice - record.priceAtPrediction) / record.priceAtPrediction) * 100;
        const predictedDirection = record.predictedChangePercent > 0 ? "up" : "down";
        // Bug fix: treat zero actual change as "up" to avoid false negatives
        // (a stock that didn't move wasn't predicted wrong if we said "up")
        const actualDirection = actualChangePct >= 0 ? "up" : "down";

        const update: Partial<KronosPredictionRecord> = {
          actualPrice,
          actualChangePercent: +actualChangePct.toFixed(3),
          checkedAt: new Date().toISOString(),
          directionCorrect: predictedDirection === actualDirection,
        };

        try {
          await updateKronosPrediction(record.id, update);
          // Also update in our local array for the response
          Object.assign(record, update);
        } catch {
          /* skip update failures */
        }
      }
    }

    // Also check current prices for recently predicted symbols (even if < 1 day old)
    const recentSymbols = [
      ...new Set(history.filter((h) => !h.actualPrice).map((h) => h.symbol)),
    ].filter((s) => !priceMap[s]);

    await Promise.all(
      recentSymbols.map(async (symbol) => {
        try {
          const yahooSymbol = `${symbol}.CA`;
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1d&range=5d`;
          const res = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
            signal: AbortSignal.timeout(10000),
          });
          if (res.ok) {
            const data = await res.json();
            const quotes = data.chart?.result?.[0]?.indicators?.quote?.[0];
            const closes: number[] = quotes?.close?.filter((c: number | null) => c !== null) ?? [];
            if (closes.length > 0) {
              priceMap[symbol] = closes[closes.length - 1];
            }
          }
        } catch {
          /* skip */
        }
      })
    );

    // Enrich all records with live price data for the UI
    const enriched = history.map((record) => ({
      ...record,
      livePrice: priceMap[record.symbol] ?? record.actualPrice ?? null,
      liveChangePct: priceMap[record.symbol]
        ? ((priceMap[record.symbol] - record.priceAtPrediction) / record.priceAtPrediction) * 100
        : record.actualChangePercent ?? null,
    }));

    // Compute stats
    const checked = enriched.filter((r) => r.directionCorrect !== undefined);
    const correct = checked.filter((r) => r.directionCorrect === true).length;
    const total = checked.length;

    return NextResponse.json({
      predictions: enriched,
      stats: {
        total: enriched.length,
        checked: total,
        correct,
        accuracy: total > 0 ? Math.round((correct / total) * 100) : null,
      },
    });
  } catch (err: any) {
    console.error("Kronos History Error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
