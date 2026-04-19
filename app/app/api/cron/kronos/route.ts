import { NextResponse } from "next/server";
import { scanAllEgx, isMarketOpen } from "@/lib/egx";
import { generateForecast } from "../../../api/egx/forecast/route";
import { getKronosHistory } from "@/lib/redis";

export const runtime = "nodejs";
export const maxDuration = 300; // Allow 5 minutes for sequential Python engine processing

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * GET /api/cron/kronos
 * 
 * Background cron job to automatically scan EGX stocks and run Kronos predictions.
 * Runs independently of user interactions to keep the "توصيات" (Recommendations) tab fresh.
 */
export async function GET(request: Request) {
  // 1. Verify cron secret (if set)
  if (CRON_SECRET) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const url = new URL(request.url);
  const forced = url.searchParams.get("force") === "1";

  // 2. Only run when market is open or if forced
  if (!forced && !isMarketOpen()) {
    return NextResponse.json({ skipped: true, reason: "Market closed" });
  }

  console.log("[kronos-cron] 🤖 Starting automatic Kronos predictions...");

  try {
    // 3. Get ALL EGX stocks to rotate through the entire market
    const allStocks = await scanAllEgx(250);
    const allSymbols = allStocks.map(s => s.symbol);
    
    // Fetch history to see what was recently scanned
    const history = await getKronosHistory(500);
    const lastPredictedMap = new Map<string, number>();
    
    for (const record of history) {
      const time = new Date(record.predictedAt).getTime();
      const existing = lastPredictedMap.get(record.symbol);
      if (!existing || time > existing) {
         lastPredictedMap.set(record.symbol, time);
      }
    }

    // Sort symbols: those never predicted come first (0), then the oldest predicted
    allSymbols.sort((a, b) => {
       const timeA = lastPredictedMap.get(a) || 0;
       const timeB = lastPredictedMap.get(b) || 0;
       return timeA - timeB;
    });
    
    // Select the top 10 oldest/unscanned stocks
    const symbolsToPredict = allSymbols.slice(0, 10);
    
    console.log(`[kronos-cron] 🎯 Selected ${symbolsToPredict.length} stocks from whole market rotation:`, symbolsToPredict);

    // 4. Run predictions sequentially to avoid overloading the Python Engine
    const results = [];
    let successCount = 0;
    let failCount = 0;

    for (const symbol of symbolsToPredict) {
      try {
        console.log(`[kronos-cron] Predicting ${symbol}...`);
        // generateForecast internally logs it to the Redis history!
        const result = await generateForecast(symbol);
        results.push({ symbol, status: "success", endPrice: result.forecast?.[result.forecast.length - 1]?.close });
        successCount++;
        
        // Wait 1 second between requests to be nice to Yahoo Finance and the Python engine
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (err: any) {
        console.error(`[kronos-cron] ❌ Failed to predict ${symbol}:`, err.message);
        results.push({ symbol, status: "error", error: err.message });
        failCount++;
      }
    }

    console.log(`[kronos-cron] ✅ Done. ${successCount} successes, ${failCount} failures.`);

    return NextResponse.json({
      ok: true,
      message: `Completed automatic Kronos predictions. Success: ${successCount}, Failed: ${failCount}`,
      runAt: new Date().toISOString(),
      results
    });

  } catch (err: any) {
    console.error("[kronos-cron] Critical Error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
