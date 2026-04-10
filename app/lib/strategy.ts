import { PricePoint } from "./redis";

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
  let gains = 0;
  let losses = 0;
  
  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  
  let avgGain = gains / period;
  let avgLoss = losses / period;
  
  for (let i = period + 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff >= 0) {
      avgGain = (avgGain * (period - 1) + diff) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) - diff) / period;
    }
  }
  
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

export interface MarketSignal {
  action: "BUY_STRONG" | "BUY" | "HOLD" | "SELL" | "SELL_STRONG";
  rsi: number | null;
  emaShort: number | null;
  emaLong: number | null;
  trend: "BULLISH" | "BEARISH" | "NEUTRAL";
  confidence: number;
}

export function analyzeMarket(history: PricePoint[]): MarketSignal {
  const prices = history.map(p => p.p);
  const rsi = getRSI(prices, 14);
  const emaShort = getEMA(prices, 5); // 5-tick EMA
  const emaLong = getEMA(prices, 20); // 20-tick EMA

  let action: MarketSignal["action"] = "HOLD";
  let trend: MarketSignal["trend"] = "NEUTRAL";
  let confidence = 0;

  // Identify trend using moving average crossovers
  if (emaShort !== null && emaLong !== null) {
     if (emaShort > emaLong) trend = "BULLISH";
     else if (emaShort < emaLong) trend = "BEARISH";
  }

  // RSI based momentum analysis
  if (rsi !== null) {
      if (rsi < 30) {
         // Oversold territory
         action = "BUY_STRONG";
         confidence = 90;
      } else if (rsi < 40) {
         action = "BUY";
         confidence = 70;
      } else if (rsi > 70) {
         // Overbought territory
         action = "SELL_STRONG";
         confidence = 90;
      } else if (rsi > 60) {
         action = "SELL";
         confidence = 70;
      }
  }

  // Enhance confidence if trend aligns with momentum
  if (action.startsWith("BUY") && trend === "BULLISH") confidence += 10;
  if (action.startsWith("SELL") && trend === "BEARISH") confidence += 10;

  // Cap confidence at 100
  confidence = Math.min(confidence, 100);

  return { action, rsi, emaShort, emaLong, trend, confidence };
}
