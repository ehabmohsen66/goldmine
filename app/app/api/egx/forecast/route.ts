import { NextResponse } from "next/server";
import { logKronosPrediction } from "@/lib/redis";

export const runtime = "nodejs";

// Transform TV symbol like "COMI" to Yahoo "COMI.CA"
export async function generateForecast(symbol: string) {
  const yahooSymbol = `${symbol}.CA`;
  const yUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1d&range=2y`;

    const yRes = await fetch(yUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
    }).catch(e => { throw new Error(`Yahoo API error for ${yahooSymbol}: ${e.message}`); });
    
    if (!yRes.ok) throw new Error("Yahoo fetch failed");
    const data = await yRes.json();
    const result = data.chart?.result?.[0];
    
    if (!result) throw new Error("No data found for symbol");

    const timestamps = result.timestamp || [];
    const quote = result.indicators?.quote?.[0] || {};
    
    // Build candles array for Kronos
    const candles = [];
    for (let i = 0; i < timestamps.length; i++) {
        // Skip incomplete data
        if (quote.close[i] === null) continue;
        
        candles.push({
            open: quote.open[i] || quote.close[i],
            high: quote.high[i] || quote.close[i],
            low: quote.low[i] || quote.close[i],
            close: quote.close[i],
            volume: quote.volume[i] || 0,
            timestamp: new Date(timestamps[i] * 1000).toISOString()
        });
    }

    if (candles.length < 50) {
        throw new Error("Not enough data to run Kronos forecast (requires > 50 days)");
    }

    // Call Kronos Engine
    const kronosUrl = process.env.KRONOS_API_URL || "http://kronos-engine.railway.internal:8000";
    const kReq = await fetch(`${kronosUrl}/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
           symbol: yahooSymbol,
           lookback: 400,
           pred_len: 120, // next 120 days
           freq: "1D",    // daily interval
           candles: candles
        })
    }).catch(e => { throw new Error(`Kronos Network Error (${kronosUrl}): ${e.message}. Is the Engine Online?`); });

    if (!kReq.ok) {
        throw new Error(`Kronos engine failed: ${await kReq.text()}`);
    }

    const kData = await kReq.json();
    const currentPrice = candles[candles.length - 1].close;
    const forecastArr: Array<{ timestamp: string; close: number }> = kData.forecast || [];
    const endPrice = forecastArr.length > 0 ? forecastArr[forecastArr.length - 1].close : currentPrice;
    const predictedHigh = forecastArr.length > 0 ? Math.max(...forecastArr.map(f => f.close)) : currentPrice;
    const predictedLow = forecastArr.length > 0 ? Math.min(...forecastArr.map(f => f.close)) : currentPrice;
    const predictedChangePct = ((endPrice - currentPrice) / currentPrice) * 100;

    // Log prediction to history for tracking accuracy
    try {
      await logKronosPrediction({
        id: `${Date.now()}-${symbol}`,
        symbol,
        predictedAt: new Date().toISOString(),
        priceAtPrediction: currentPrice,
        predictedHigh,
        predictedLow,
        predictedChangePercent: predictedChangePct,
        predictedEndPrice: endPrice,
        predictionDays: 120,
      });
    } catch (e) {
      console.warn("Failed to log Kronos prediction to history:", e);
    }

    // We only need the forecast array to return
    return {
        ok: true,
        symbol,
        currentPrice,
        forecast: forecastArr,
    };
}

export async function POST(req: Request) {
  try {
    const { symbol } = await req.json();
    if (!symbol) return NextResponse.json({ error: "Symbol required" }, { status: 400 });
    
    const result = await generateForecast(symbol);
    return NextResponse.json(result);

  } catch (err: any) {
    console.error("Kronos EGX Error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
