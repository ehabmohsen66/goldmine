import { Redis } from "@upstash/redis";

// Lazy singleton — works in both Vercel and local (process.env fallback)
let _redis: Redis | null = null;

export function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
  }
  return _redis;
}

// ── Key names ────────────────────────────────────────────────────────────────
export const KEYS = {
  STATE: "goldmine:state",
  BOT_ENABLED: "goldmine:enabled",
  TRADES: "goldmine:trades",
  PRICE_HISTORY: "goldmine:prices",
  LAST_ADD_FUNDS_ALERT: "goldmine:last_add_funds",
  LAST_HOLDING_ALERT: "goldmine:last_holding_alert",
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────
export interface BotState {
  in_position: boolean;
  buy_price: number | null;
  buy_time: string | null;
  grams_held: number | null;
  egp_invested: number | null;
  peak_price: number | null;
  wallet_balance: number | null;
  total_profit: number;
  trade_count: number;
  last_price: number | null;
  last_tick: string | null;
  status: "running" | "stopped" | "error";
  last_error: string | null;
}

export interface Trade {
  id: string;
  timestamp: string;
  action: "BUY" | "SELL";
  price: number;
  egp_amount: number;
  grams: number;
  profit: number;
  wallet_balance: number;
}

export interface PricePoint {
  t: number; // unix timestamp ms
  p: number; // price EGP/gram
}

// ── State helpers ─────────────────────────────────────────────────────────────
export async function getState(): Promise<BotState> {
  const r = getRedis();
  const raw = await r.get<BotState>(KEYS.STATE);
  return (
    raw ?? {
      in_position: false,
      buy_price: null,
      buy_time: null,
      grams_held: null,
      egp_invested: null,
      peak_price: null,
      wallet_balance: null,
      total_profit: 0,
      trade_count: 0,
      last_price: null,
      last_tick: null,
      status: "stopped",
      last_error: null,
    }
  );
}

export async function saveState(state: BotState): Promise<void> {
  await getRedis().set(KEYS.STATE, state);
}

export async function isBotEnabled(): Promise<boolean> {
  const val = await getRedis().get<string | boolean>(KEYS.BOT_ENABLED);
  return val === "true" || val === true;
}

export async function setBotEnabled(enabled: boolean): Promise<void> {
  await getRedis().set(KEYS.BOT_ENABLED, enabled ? "true" : "false");
}

// ── Trade helpers ─────────────────────────────────────────────────────────────
export async function logTrade(trade: Omit<Trade, "id">): Promise<void> {
  const r = getRedis();
  const full: Trade = { ...trade, id: `${Date.now()}-${Math.random().toString(36).slice(2)}` };
  await r.lpush(KEYS.TRADES, JSON.stringify(full));
  // Keep last 500 trades
  await r.ltrim(KEYS.TRADES, 0, 499);
}

export async function getTrades(limit = 50): Promise<Trade[]> {
  const r = getRedis();
  const raw = await r.lrange(KEYS.TRADES, 0, limit - 1);
  return raw.map((item) => (typeof item === "string" ? JSON.parse(item) : item));
}

// ── Price history helpers ─────────────────────────────────────────────────────
export async function appendPrice(price: number): Promise<void> {
  const r = getRedis();
  const point: PricePoint = { t: Date.now(), p: price };
  await r.lpush(KEYS.PRICE_HISTORY, JSON.stringify(point));
  await r.ltrim(KEYS.PRICE_HISTORY, 0, 1439); // keep 24h at 1-min intervals
}

export async function getPriceHistory(limit = 120): Promise<PricePoint[]> {
  const r = getRedis();
  const raw = await r.lrange(KEYS.PRICE_HISTORY, 0, limit - 1);
  return raw
    .map((item) => (typeof item === "string" ? JSON.parse(item) : item))
    .reverse(); // oldest first for charts
}
