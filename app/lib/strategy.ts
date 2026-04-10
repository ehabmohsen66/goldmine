import { PricePoint } from "./redis";

// ─── Basic Indicators ──────────────────────────────────────────────────────────

export function getSMA(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const slice = prices.slice(prices.length - period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export function getEMA(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = prices[0];
  for (let i = 1; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

export function getRSI(prices: number[], period = 14): number | null {
  if (prices.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff >= 0) { avgGain = (avgGain * (period - 1) + diff) / period; avgLoss = (avgLoss * (period - 1)) / period; }
    else { avgGain = (avgGain * (period - 1)) / period; avgLoss = (avgLoss * (period - 1) - diff) / period; }
  }
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

/**
 * ATR (Average True Range) as a % of price.
 * Shows how volatile the market currently is.
 * E.g. 0.5 = market is moving ±0.5% per tick on average.
 */
export function getATRPct(history: PricePoint[], period = 20): number {
  if (history.length < 2) return 0.5; // default fallback
  const ranges: number[] = [];
  for (let i = 1; i < history.length; i++) {
    const high = Math.max(history[i].p, history[i - 1].p);
    const low  = Math.min(history[i].p, history[i - 1].p);
    ranges.push(((high - low) / history[i - 1].p) * 100);
  }
  const slice = ranges.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

// ─── Market Signal ─────────────────────────────────────────────────────────────

export interface MarketSignal {
  action: "BUY_STRONG" | "BUY" | "HOLD" | "SELL" | "SELL_STRONG";
  rsi: number | null;
  emaShort: number | null;
  emaLong: number | null;
  atrPct: number;
  trend: "BULLISH" | "BEARISH" | "NEUTRAL";
  confidence: number;
  /** Adaptive dip threshold adjusted for current volatility */
  adaptiveDipPct: number;
  /** Adaptive trail distance adjusted for current volatility */
  adaptiveTrailPct: number;
}

export function analyzeMarket(
  history: PricePoint[],
  baseDipPct = 0.5,
  baseTrailPct = 0.4
): MarketSignal {
  const prices = history.map(p => p.p);
  const rsi = getRSI(prices, 14);
  const emaShort = getEMA(prices, 5);
  const emaLong  = getEMA(prices, 20);
  const atrPct   = getATRPct(history, 20);

  // Scale thresholds with volatility
  // If market is calm (atr ~0.1%), use tight thresholds
  // If market is volatile (atr ~1%), widen thresholds to avoid noise
  const volatilityMultiplier = Math.max(1, atrPct / 0.3);
  const adaptiveDipPct   = parseFloat(Math.min(baseDipPct * volatilityMultiplier, baseDipPct * 3).toFixed(3));
  const adaptiveTrailPct = parseFloat(Math.min(baseTrailPct * volatilityMultiplier, baseTrailPct * 3).toFixed(3));

  let action: MarketSignal["action"] = "HOLD";
  let trend: MarketSignal["trend"] = "NEUTRAL";
  let confidence = 0;

  if (emaShort !== null && emaLong !== null) {
    if (emaShort > emaLong) trend = "BULLISH";
    else if (emaShort < emaLong) trend = "BEARISH";
  }

  if (rsi !== null) {
    if (rsi < 30)      { action = "BUY_STRONG"; confidence = 90; }
    else if (rsi < 40) { action = "BUY";        confidence = 70; }
    else if (rsi > 70) { action = "SELL_STRONG"; confidence = 90; }
    else if (rsi > 60) { action = "SELL";        confidence = 70; }
  }

  if (action.startsWith("BUY")  && trend === "BULLISH") confidence += 10;
  if (action.startsWith("SELL") && trend === "BEARISH") confidence += 10;
  confidence = Math.min(confidence, 100);

  return { action, rsi, emaShort, emaLong, atrPct, trend, confidence, adaptiveDipPct, adaptiveTrailPct };
}
