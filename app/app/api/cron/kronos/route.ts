import { NextResponse } from "next/server";
import { getEgxDailyBrief, isMarketOpen } from "@/lib/egx";
import { generateForecast } from "../../../api/egx/forecast/route";

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
    // 3. Get top EGX stocks to predict on
    // We fetch the brief because it already pre-sorts the top buys, gainers, and watchlist
    const brief = await getEgxDailyBrief();
    
    // We want to prioritize generating predictions for:
    // a. Top Buys (Highest TradingView score)
    // b. Watchlist (RSI oversold)
    // c. Top Gainers (Momentum)
    
    // Combine them and ensure uniqueness by symbol
    const targetStocks = [
      ...brief.topBuys,
      ...brief.watchlist,
      ...brief.topGainers
    ];
    
    const uniqueSymbols = Array.from(new Set(targetStocks.map(s => s.symbol)));
    
    // Limit to 10 to prevent the cron job from timing out (maxDuration = 55s)
    const symbolsToPredict = uniqueSymbols.slice(0, 10);
    
    console.log(`[kronos-cron] 🎯 Selected ${symbolsToPredict.length} stocks for prediction:`, symbolsToPredict);

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
