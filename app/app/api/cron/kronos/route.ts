import { NextResponse } from "next/server";
import { scanAllEgx, type EgxStock } from "@/lib/egx";
import { generateForecast } from "../../../api/egx/forecast/route";
import { getKronosHistory, getPaperTrades, logPaperTrade, type PaperTrade } from "@/lib/redis";

export const runtime = "nodejs";
export const maxDuration = 300;

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * GET /api/cron/kronos
 * 
 * Background cron job: scans the ENTIRE EGX market, runs Kronos predictions,
 * applies Ensemble Consensus scoring (AI + TradingView + Volume), and
 * automatically paper-trades bullish consensus signals.
 */
export async function GET(request: Request) {
  if (CRON_SECRET) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  console.log("[kronos-cron] 🤖 Starting Kronos + Ensemble scan...");

  try {
    // 1. Get ALL EGX stocks (with TradingView data already included)
    const allStocks = await scanAllEgx(250);
    const stockMap = new Map<string, EgxStock>();
    for (const s of allStocks) stockMap.set(s.symbol, s);
    
    const allSymbols = allStocks.map(s => s.symbol);
    
    // 2. Find which stocks need fresh predictions (rotation)
    const history = await getKronosHistory(1000);
    const lastPredictedMap = new Map<string, number>();
    
    for (const record of history) {
      const time = new Date(record.predictedAt).getTime();
      const existing = lastPredictedMap.get(record.symbol);
      if (!existing || time > existing) {
        lastPredictedMap.set(record.symbol, time);
      }
    }

    // Sort: never-predicted first, then oldest
    allSymbols.sort((a, b) => {
      const timeA = lastPredictedMap.get(a) || 0;
      const timeB = lastPredictedMap.get(b) || 0;
      return timeA - timeB;
    });
    
    // Process 2 stocks per cycle (runs every minute = 120 stocks/hour)
    const symbolsToPredict = allSymbols.slice(0, 2);

    // Bug fix: load existing paper trades to prevent duplicate paper trades per symbol per day
    const existingPaperTrades = await getPaperTrades(500);
    const recentPaperTradeSymbols = new Set(
      existingPaperTrades
        .filter(t => !t.settled && Date.now() - new Date(t.entryDate).getTime() < 24 * 60 * 60 * 1000)
        .map(t => t.symbol)
    );
    
    console.log(`[kronos-cron] 🎯 Rotating: ${symbolsToPredict.join(", ")}`);

    const results = [];
    let successCount = 0;
    let failCount = 0;
    let paperTradeCount = 0;

    for (const symbol of symbolsToPredict) {
      try {
        console.log(`[kronos-cron] Predicting ${symbol}...`);
        const result = await generateForecast(symbol);
        const forecastPrice = result.forecast?.[result.forecast.length - 1]?.close;
        const currentPrice = result.currentPrice;
        
        if (!forecastPrice || !currentPrice) {
          results.push({ symbol, status: "error", error: "No forecast returned" });
          failCount++;
          continue;
        }

        const predictedChangePct = ((forecastPrice - currentPrice) / currentPrice) * 100;
        const kronosSignal: "BUY" | "SELL" = predictedChangePct > 0 ? "BUY" : "SELL";

        // ── ENSEMBLE CONSENSUS ENGINE ─────────────────────────────────────
        const tvStock = stockMap.get(symbol);
        let consensusCount = 0;

        // Signal 1: Kronos AI prediction
        if (kronosSignal === "BUY") consensusCount++;

        // Signal 2: TradingView technical score
        const tvSignal = tvStock?.signal ?? "HOLD";
        const tvScore = tvStock?.recommendAll ?? 0;
        if (tvSignal === "STRONG_BUY" || tvSignal === "BUY") consensusCount++;

        // Signal 3: RSI oversold proxy (RSI < 40 = undervalued, momentum building)
        // True volume anomaly detection requires 30-day avg data from Yahoo.
        // We use RSI as the best available proxy from the TradingView screener.
        const volumeRatio = tvStock?.volume ?? 0; // raw volume for display
        if (tvStock?.rsi !== null && tvStock?.rsi !== undefined && tvStock.rsi < 40) consensusCount++

        // Signal 4: Positive daily momentum (stock is already trending up today)
        if (tvStock && tvStock.change > 0) consensusCount++;

        const ensembleResult = {
          symbol,
          kronosSignal,
          predictedChangePct: +predictedChangePct.toFixed(3),
          tvSignal,
          tvScore,
          volumeRatio,
          consensusCount,
          strength: consensusCount >= 3 ? "HIGH" : consensusCount >= 2 ? "MEDIUM" : "LOW",
        };

        results.push({ symbol, status: "success", ensemble: ensembleResult });
        successCount++;

        // ── AUTO PAPER TRADE ───────────────────────────────────────────────
        // Bug fix: Only open ONE paper trade per symbol per 24-hour cycle.
        // Previously a new trade was created every minute when the stock was re-scanned.
        if (kronosSignal === "BUY" && !recentPaperTradeSymbols.has(symbol)) {
          const paperTrade: PaperTrade = {
            id: `paper-${Date.now()}-${symbol}`,
            symbol,
            entryDate: new Date().toISOString(),
            entryPrice: currentPrice,
            predictedPrice: forecastPrice,
            predictedChangePct: +predictedChangePct.toFixed(3),
            settled: false,
            kronosSignal,
            tvScore,
            tvSignal,
            volumeRatio,
            consensusCount,
          };
          await logPaperTrade(paperTrade);
          recentPaperTradeSymbols.add(symbol); // prevent duplicates within same cron batch
          paperTradeCount++;
          console.log(`[kronos-cron] 📄 Paper BUY: ${symbol} @ ${currentPrice.toFixed(2)} → target ${forecastPrice.toFixed(2)} (${consensusCount}/4 consensus)`);
        } else if (kronosSignal === "BUY") {
          console.log(`[kronos-cron] ⏭️ Skipped duplicate paper trade for ${symbol} (already open today)`);
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (err: any) {
        console.error(`[kronos-cron] ❌ Failed ${symbol}:`, err.message);
        results.push({ symbol, status: "error", error: err.message });
        failCount++;
      }
    }

    console.log(`[kronos-cron] ✅ Done. ${successCount} OK, ${failCount} fail, ${paperTradeCount} paper trades.`);

    return NextResponse.json({
      ok: true,
      message: `Kronos: ${successCount} success, ${failCount} failed, ${paperTradeCount} paper trades`,
      runAt: new Date().toISOString(),
      results
    });

  } catch (err: any) {
    console.error("[kronos-cron] Critical Error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
