import { NextResponse } from "next/server";
import { getPaperTrades, updatePaperTrade, type PaperTrade } from "@/lib/redis";

export const runtime = "nodejs";

/**
 * GET /api/egx/paper-trades
 * 
 * Returns paper trading P&L stats and trade history.
 * Automatically settles unsettled trades older than 24 hours by checking Yahoo Finance.
 */
export async function GET() {
  try {
    const trades = await getPaperTrades(500);

    // ── Settle unsettled trades older than 24 hours ──────────────────────
    const unsettled = trades.filter(
      t => !t.settled && Date.now() - new Date(t.entryDate).getTime() > 24 * 60 * 60 * 1000
    );

    const symbolsToCheck = [...new Set(unsettled.map(t => t.symbol))];
    const priceMap: Record<string, number> = {};

    await Promise.all(
      symbolsToCheck.map(async (symbol) => {
        try {
          const yahooSym = `${symbol}.CA`;
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSym}?interval=1d&range=5d`;
          const res = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
            signal: AbortSignal.timeout(10000),
          });
          if (!res.ok) return;
          const data = await res.json();
          const closes: number[] = (data.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [])
            .filter((c: number | null) => c !== null);
          // Bug fix: use second-to-last close (yesterday's confirmed close) for settling
          // 1-day predictions. The last element is today's intraday price which is still moving.
          // For predictions made yesterday, the correct exit price is yesterday's official close.
          if (closes.length >= 2) {
            priceMap[symbol] = closes[closes.length - 2]; // yesterday's confirmed close
          } else if (closes.length === 1) {
            priceMap[symbol] = closes[0];
          }
        } catch { /* skip */ }
      })
    );

    // Update unsettled trades with actual prices
    for (const trade of unsettled) {
      const exitPrice = priceMap[trade.symbol];
      if (exitPrice !== undefined) {
        const pnlPct = ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100;
        const pnlEgp = (pnlPct / 100) * 1000; // P&L per 1000 EGP invested
        const directionCorrect = (trade.predictedChangePct > 0 && pnlPct > 0) ||
                                  (trade.predictedChangePct < 0 && pnlPct < 0);

        const update: Partial<PaperTrade> = {
          settled: true,
          exitDate: new Date().toISOString(),
          exitPrice,
          pnlPct: +pnlPct.toFixed(3),
          pnlEgp: +pnlEgp.toFixed(2),
          directionCorrect,
        };

        await updatePaperTrade(trade.id, update);
        Object.assign(trade, update);
      }
    }

    // ── Calculate Stats ──────────────────────────────────────────────────
    const settled = trades.filter(t => t.settled);
    const totalTrades = settled.length;
    const wins = settled.filter(t => t.directionCorrect === true).length;
    const losses = settled.filter(t => t.directionCorrect === false).length;
    const winRate = totalTrades > 0 ? Math.round((wins / totalTrades) * 100) : null;

    const totalPnlPct = settled.reduce((sum, t) => sum + (t.pnlPct ?? 0), 0);
    const totalPnlEgp = settled.reduce((sum, t) => sum + (t.pnlEgp ?? 0), 0);
    const avgPnlPct = totalTrades > 0 ? totalPnlPct / totalTrades : 0;

    // Best & worst trade
    const bestTrade = settled.length > 0
      ? settled.reduce((best, t) => (t.pnlPct ?? 0) > (best.pnlPct ?? 0) ? t : best)
      : null;
    const worstTrade = settled.length > 0
      ? settled.reduce((worst, t) => (t.pnlPct ?? 0) < (worst.pnlPct ?? 0) ? t : worst)
      : null;

    // Consensus accuracy breakdown
    const highConsensus = settled.filter(t => (t.consensusCount ?? 0) >= 3);
    const highConsensusWins = highConsensus.filter(t => t.directionCorrect).length;
    const highConsensusRate = highConsensus.length > 0
      ? Math.round((highConsensusWins / highConsensus.length) * 100)
      : null;

    // Compounding: if you invested 10,000 EGP and followed every signal
    let compoundedBalance = 10000;
    const sortedSettled = [...settled].sort((a, b) =>
      new Date(a.entryDate).getTime() - new Date(b.entryDate).getTime()
    );
    for (const t of sortedSettled) {
      compoundedBalance *= (1 + (t.pnlPct ?? 0) / 100);
    }

    return NextResponse.json({
      trades: trades.slice(0, 100), // latest 100
      stats: {
        totalTrades,
        pendingTrades: trades.filter(t => !t.settled).length,
        wins,
        losses,
        winRate,
        totalPnlPct: +totalPnlPct.toFixed(2),
        totalPnlEgp: +totalPnlEgp.toFixed(2),
        avgPnlPct: +avgPnlPct.toFixed(3),
        bestTrade: bestTrade ? { symbol: bestTrade.symbol, pnlPct: bestTrade.pnlPct } : null,
        worstTrade: worstTrade ? { symbol: worstTrade.symbol, pnlPct: worstTrade.pnlPct } : null,
        highConsensusWinRate: highConsensusRate,
        highConsensusTrades: highConsensus.length,
        // Compounding simulation
        startingBalance: 10000,
        compoundedBalance: +compoundedBalance.toFixed(2),
        compoundedReturnPct: +(((compoundedBalance - 10000) / 10000) * 100).toFixed(2),
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("Paper Trades Error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
