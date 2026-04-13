/**
 * EGX (Egyptian Exchange) market data service.
 * Calls TradingView's public screener API directly — no Python, no sidecar.
 * Mirrors the logic from tradingview-mcp's egx_service.py.
 */

const TV_SCREENER_URL = "https://scanner.tradingview.com/egypt/scan";

// Fields we want back from TradingView for each stock
const FIELDS = [
  "name",
  "description",
  "close",
  "change",
  "change_abs",
  "volume",
  "market_cap_basic",
  "RSI",
  "RSI[1]",
  "MACD.macd",
  "MACD.signal",
  "BB.upper",
  "BB.lower",
  "BB.basis",
  "EMA20",
  "EMA50",
  "EMA200",
  "Recommend.All",
  "Recommend.MA",
  "Recommend.Other",
  "sector",
  "exchange",
];

export interface EgxStock {
  symbol: string;
  name: string;
  price: number;
  change: number;       // % change
  changeAbs: number;    // absolute EGP change
  volume: number;
  marketCap: number | null;
  rsi: number | null;
  macd: number | null;
  macdSignal: number | null;
  bbUpper: number | null;
  bbLower: number | null;
  bbBasis: number | null;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  recommendAll: number | null;   // -1 to +1 (TV oscillator)
  sector: string | null;
  signal: "STRONG_BUY" | "BUY" | "HOLD" | "SELL" | "STRONG_SELL";
  score: number;        // 0–100
}

/** Map TradingView's Recommend.All (-1 to +1) → human signal */
function toSignal(rec: number | null): EgxStock["signal"] {
  if (rec === null) return "HOLD";
  if (rec >= 0.5)  return "STRONG_BUY";
  if (rec >= 0.1)  return "BUY";
  if (rec <= -0.5) return "STRONG_SELL";
  if (rec <= -0.1) return "SELL";
  return "HOLD";
}

/** Convert TV recommend (-1..+1) to a 0-100 score */
function toScore(rec: number | null, rsi: number | null): number {
  const recScore = rec !== null ? Math.round(((rec + 1) / 2) * 60) : 30; // 0-60
  const rsiScore = rsi !== null
    ? rsi < 30 ? 40            // oversold = very bullish
    : rsi > 70 ? 0             // overbought = bearish
    : Math.round((1 - Math.abs(rsi - 50) / 50) * 40)
    : 20;
  return Math.min(100, Math.max(0, recScore + rsiScore));
}

/** Parse raw TV screener row into EgxStock */
function parseRow(row: { s: string; d: (number | string | null)[] }): EgxStock {
  const [
    name, description, close, change, changeAbs, volume, marketCap,
    rsi, _rsi1, macd, macdSignal,
    bbUpper, bbLower, bbBasis,
    ema20, ema50, ema200,
    recAll, _recMa, _recOther,
    sector,
  ] = row.d as (number | string | null)[];

  const recNum = typeof recAll === "number" ? recAll : null;
  const rsiNum = typeof rsi === "number" ? rsi : null;

  return {
    symbol: row.s.replace("EGX:", ""),
    name: (description as string) || (name as string) || row.s,
    price: (close as number) ?? 0,
    change: (change as number) ?? 0,
    changeAbs: (changeAbs as number) ?? 0,
    volume: (volume as number) ?? 0,
    marketCap: typeof marketCap === "number" ? marketCap : null,
    rsi: rsiNum,
    macd: typeof macd === "number" ? macd : null,
    macdSignal: typeof macdSignal === "number" ? macdSignal : null,
    bbUpper: typeof bbUpper === "number" ? bbUpper : null,
    bbLower: typeof bbLower === "number" ? bbLower : null,
    bbBasis: typeof bbBasis === "number" ? bbBasis : null,
    ema20: typeof ema20 === "number" ? ema20 : null,
    ema50: typeof ema50 === "number" ? ema50 : null,
    ema200: typeof ema200 === "number" ? ema200 : null,
    recommendAll: recNum,
    sector: (sector as string) || null,
    signal: toSignal(recNum),
    score: toScore(recNum, rsiNum),
  };
}

/** Base screener call — returns ALL EGX stocks with indicators */
export async function scanAllEgx(limit = 200): Promise<EgxStock[]> {
  const body = {
    columns: FIELDS,
    filter: [],
    markets: ["egypt"],
    options: { lang: "en" },
    range: [0, limit],
    sort: { sortBy: "Recommend.All", sortOrder: "desc" },
    symbols: {},
  };

  const res = await fetch(TV_SCREENER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; Goldmine/1.0)",
      "Origin": "https://www.tradingview.com",
      "Referer": "https://www.tradingview.com/",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`TradingView screener error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json() as { data: { s: string; d: (number | string | null)[] }[] };
  return (data.data ?? []).map(parseRow);
}

/** Check if EGX market is currently open (Sun-Thu, 10:00-14:30 Cairo) */
export function isMarketOpen(): boolean {
  const cairo = new Date(new Date().toLocaleString("en-US", { timeZone: "Africa/Cairo" }));
  const day = cairo.getDay(); // 0=Sun, 6=Sat
  const h = cairo.getHours();
  const m = cairo.getMinutes();
  const minuteOfDay = h * 60 + m;

  const isWeekday = day >= 0 && day <= 4; // Sun=0 to Thu=4
  const isInSession = minuteOfDay >= 600 && minuteOfDay <= 870; // 10:00 to 14:30
  return isWeekday && isInSession;
}

/** Full EGX daily overview for the dashboard */
export async function getEgxDailyBrief(): Promise<{
  topBuys: EgxStock[];
  topGainers: EgxStock[];
  topLosers: EgxStock[];
  watchlist: EgxStock[];
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  totalScanned: number;
}> {
  const all = await scanAllEgx(200);

  const bullish = all.filter(s => s.signal === "BUY" || s.signal === "STRONG_BUY");
  const bearish = all.filter(s => s.signal === "SELL" || s.signal === "STRONG_SELL");
  const neutral = all.filter(s => s.signal === "HOLD");

  const topBuys = bullish.sort((a, b) => b.score - a.score).slice(0, 5);
  const topGainers = [...all].filter(s => s.change > 0).sort((a, b) => b.change - a.change).slice(0, 5);
  const topLosers = [...all].filter(s => s.change < 0).sort((a, b) => a.change - b.change).slice(0, 5);
  const watchlist = all
    .filter(s => s.rsi !== null && s.rsi < 35 && s.change > -3)
    .sort((a, b) => (a.rsi ?? 50) - (b.rsi ?? 50))
    .slice(0, 5);

  return { topBuys, topGainers, topLosers, watchlist, bullishCount: bullish.length, bearishCount: bearish.length, neutralCount: neutral.length, totalScanned: all.length };
}
