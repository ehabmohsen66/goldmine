import { NextResponse } from "next/server";
import { scanAllEgx } from "@/lib/egx";
import { getRedis } from "@/lib/redis";

export const runtime = "nodejs";
export const maxDuration = 60;

const PICKS_KEY = "signals:daily_picks";
const PICKS_TTL = 60 * 60 * 8; // cache 8 hours

export interface SignalPick {
  symbol: string;
  name: string;
  type: "EGX" | "GOLD";
  price: number;
  change: number;          // today's % change
  rsi: number | null;
  signal: string;          // STRONG_BUY | BUY | HOLD | SELL | STRONG_SELL
  score: number;           // 0–100 conviction score
  reason: string;          // human-readable explanation
  // Scoring breakdown
  tvScore: number;         // TradingView technicals score (0–40)
  rsiScore: number;        // RSI-based score (0–30)
  macdScore: number;       // MACD cross score (0–20)
  momentumScore: number;   // price momentum score (0–10)
  generatedAt: string;
}

/** Score a stock 0–100 based on multiple technical factors */
function scoreStock(s: {
  symbol: string;
  name: string;
  price: number;
  change: number;
  rsi: number | null;
  macd: number | null;
  macdSignal: number | null;
  recommendAll: number | null;
  signal: string;
}): { score: number; tvScore: number; rsiScore: number; macdScore: number; momentumScore: number; reason: string } {
  // 1. TradingView composite signal (0–40 pts)
  const rec = s.recommendAll ?? 0;
  const tvScore = Math.round(((rec + 1) / 2) * 40); // maps -1..+1 → 0..40

  // 2. RSI score (0–30 pts) — oversold is bullish
  let rsiScore = 15; // neutral default
  const rsi = s.rsi;
  if (rsi !== null) {
    if (rsi < 25)      rsiScore = 30; // deeply oversold — strong buy signal
    else if (rsi < 35) rsiScore = 25;
    else if (rsi < 45) rsiScore = 20;
    else if (rsi < 55) rsiScore = 15;
    else if (rsi < 65) rsiScore = 10;
    else if (rsi < 75) rsiScore = 5;
    else               rsiScore = 0;  // overbought — don't buy
  }

  // 3. MACD cross (0–20 pts) — macd > signal line = bullish momentum
  let macdScore = 10; // neutral default
  if (s.macd !== null && s.macdSignal !== null) {
    const macdDiff = s.macd - s.macdSignal;
    if (macdDiff > 0.05)       macdScore = 20; // strong bullish cross
    else if (macdDiff > 0.01)  macdScore = 15;
    else if (macdDiff > 0)     macdScore = 12;
    else if (macdDiff > -0.01) macdScore = 8;
    else if (macdDiff > -0.05) macdScore = 4;
    else                       macdScore = 0;  // bearish divergence
  }

  // 4. Price momentum (0–10 pts) — slight positive change today is bullish
  let momentumScore = 5; // neutral
  if (s.change > 2)       momentumScore = 10;
  else if (s.change > 0)  momentumScore = 7;
  else if (s.change > -1) momentumScore = 4;
  else                    momentumScore = 0;

  const score = Math.min(100, tvScore + rsiScore + macdScore + momentumScore);

  // Build reason string
  const reasons: string[] = [];
  if (tvScore >= 25) reasons.push(`إشارة TradingView ${s.signal.replace("_", " ")}`);
  if (rsi !== null && rsi < 35) reasons.push(`RSI منخفض (${rsi.toFixed(0)}) — مستوى شراء`);
  if (macdScore >= 15) reasons.push("تقاطع MACD صاعد");
  if (s.change > 1.5) reasons.push(`زخم إيجابي +${s.change.toFixed(1)}%`);
  if (reasons.length === 0) reasons.push("مؤشرات فنية متوسطة");

  return { score, tvScore, rsiScore, macdScore, momentumScore, reason: reasons.join(" · ") };
}

/** Fetch gold price in EGP from Yahoo Finance (XAUUSD * USDEGP) */
async function fetchGoldEgp(): Promise<{ price: number; change: number } | null> {
  try {
    // Fetch XAU/USD
    const [xauRes, usdRes] = await Promise.all([
      fetch("https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1d&range=5d", {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(10000),
      }),
      fetch("https://query1.finance.yahoo.com/v8/finance/chart/USDEGP=X?interval=1d&range=2d", {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(10000),
      }),
    ]);

    if (!xauRes.ok || !usdRes.ok) return null;

    const [xauData, usdData] = await Promise.all([xauRes.json(), usdRes.json()]);

    const xauCloses: number[] = (xauData.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? []).filter((c: number | null) => c !== null);
    const usdCloses: number[] = (usdData.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? []).filter((c: number | null) => c !== null);

    if (xauCloses.length < 2 || usdCloses.length < 1) return null;

    const xauPrice = xauCloses[xauCloses.length - 1];
    const xauPrev  = xauCloses[xauCloses.length - 2];
    const usdEgp   = usdCloses[usdCloses.length - 1];

    const priceEgp = xauPrice * usdEgp; // price per troy oz in EGP
    const prevEgp  = xauPrev * usdEgp;
    const change   = ((priceEgp - prevEgp) / prevEgp) * 100;

    return { price: +priceEgp.toFixed(2), change: +change.toFixed(2) };
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const r = getRedis();

  // Return cached picks unless forced refresh
  if (!force) {
    const cached = await r.get<string>(PICKS_KEY);
    if (cached) {
      try {
        const parsed = typeof cached === "string" ? JSON.parse(cached) : cached;
        return NextResponse.json(parsed);
      } catch { /* re-generate */ }
    }
  }

  try {
    // Run EGX scan + gold fetch in parallel
    const [stocks, gold] = await Promise.all([
      scanAllEgx(250),
      fetchGoldEgp(),
    ]);

    // Score and rank all EGX stocks
    const scoredStocks = stocks.map(s => {
      const { score, tvScore, rsiScore, macdScore, momentumScore, reason } = scoreStock(s);
      return {
        symbol: s.symbol,
        name: s.name,
        type: "EGX" as const,
        price: s.price,
        change: s.change,
        rsi: s.rsi,
        signal: s.signal,
        score,
        reason,
        tvScore,
        rsiScore,
        macdScore,
        momentumScore,
        generatedAt: new Date().toISOString(),
      };
    });

    // Keep only bullish picks (score >= 50 and signal not SELL/STRONG_SELL)
    const bullishPicks = scoredStocks
      .filter(s => s.score >= 50 && s.signal !== "SELL" && s.signal !== "STRONG_SELL")
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    // Build gold pick
    const goldPick: SignalPick | null = gold ? (() => {
      // Gold scoring is simpler: use price momentum + a general "safe haven" baseline
      let goldScore = 55; // baseline — gold is generally a safe store of value
      let goldReason = "ملاذ آمن وتحوط ضد التضخم";
      if (gold.change > 1)       { goldScore += 15; goldReason = `زخم صاعد +${gold.change.toFixed(1)}% · ${goldReason}`; }
      else if (gold.change > 0)  { goldScore += 5;  goldReason = `مستقر إيجابياً · ${goldReason}`; }
      else if (gold.change < -1) { goldScore -= 10; goldReason = `تراجع ${gold.change.toFixed(1)}% — قد يكون فرصة شراء`; }

      return {
        symbol: "XAU",
        name: "الذهب (XAU/EGP)",
        type: "GOLD" as const,
        price: gold.price,
        change: gold.change,
        rsi: null,
        signal: goldScore >= 60 ? "STRONG_BUY" : goldScore >= 50 ? "BUY" : "HOLD",
        score: Math.min(100, goldScore),
        reason: goldReason,
        tvScore: 0,
        rsiScore: 0,
        macdScore: 0,
        momentumScore: gold.change > 0 ? 7 : 3,
        generatedAt: new Date().toISOString(),
      };
    })() : null;

    const result = {
      picks: bullishPicks,
      goldPick,
      stats: {
        totalScanned: stocks.length,
        bullishCount: bullishPicks.length,
        strongBuyCount: bullishPicks.filter(p => p.signal === "STRONG_BUY").length,
        generatedAt: new Date().toISOString(),
      },
    };

    // Cache for 8 hours
    await r.set(PICKS_KEY, JSON.stringify(result), { ex: PICKS_TTL });

    return NextResponse.json(result);
  } catch (err: any) {
    console.error("[signals/picks] Error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
