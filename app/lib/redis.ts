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
  // EGX
  EGX_ALERTS: "egx:alerts",                  // list of EgxAlert (history)
  EGX_PORTFOLIO: "egx:portfolio",             // hash: symbol → EgxPosition
  EGX_THNDR_PORTFOLIO: "egx:thndr_portfolio", // JSON list of Thndr position
  EGX_LAST_SCAN: "egx:last_scan",             // timestamp of last scan
  EGX_STOCK_COOLDOWN: (sym: string) => `egx:cooldown:${sym}`, // per-stock cooldown
  // Kronos
  KRONOS_FORECAST: "kronos:last_forecast",    // last AI forecast result
} as const;

// ── Kronos ───────────────────────────────────────────────────────────────────
export interface KronosForecastEntry {
  symbol: string;
  fetchedAt: string;        // ISO timestamp when fetched
  currentPrice: number;
  forecast: Array<{ timestamp: string; close: number; open: number; high: number; low: number }>;
  predictedHigh: number;
  predictedLow: number;
  predictedChangePercent: number; // relative to currentPrice
  buySuppressed: boolean;         // true = kronos paused the bot's DCA buy
  engineOnline: boolean;
}

export async function getKronosForecast(): Promise<KronosForecastEntry | null> {
  const r = getRedis();
  const raw = await r.get<string>(KEYS.KRONOS_FORECAST);
  if (!raw) return null;
  try { return typeof raw === "string" ? JSON.parse(raw) : raw as KronosForecastEntry; }
  catch { return null; }
}

export async function saveKronosForecast(entry: KronosForecastEntry): Promise<void> {
  const r = getRedis();
  await r.set(KEYS.KRONOS_FORECAST, JSON.stringify(entry), { ex: 60 * 60 * 6 }); // 6hr TTL
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface BotState {
  in_position: boolean;
  buy_price: number | null;
  buy_time: string | null;
  grams_held: number | null;
  egp_invested: number | null;
  peak_price: number | null;
  trailing_high: number | null;   // highest price seen after buying (trailing stop)
  dca_level: number;              // 0=watching, 1=first buy, 2=second buy, 3=fully in
  dca_reserved: number;           // EGP reserved for further DCA buys
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
      trailing_high: null,
      dca_level: 0,
      dca_reserved: 0,
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
  const raw = (await r.lrange(KEYS.PRICE_HISTORY, 0, limit - 1)) ?? [];
  return raw
    .map((item) => (typeof item === "string" ? JSON.parse(item) : item))
    .reverse();
}

// ── EGX Portfolio & Alert types ───────────────────────────────────────────────

export type EgxAlertAction = "BUY" | "SELL" | "WATCH";

export interface EgxAlert {
  id: string;
  timestamp: string;
  symbol: string;
  name: string;
  action: EgxAlertAction;
  price: number;
  change: number;
  rsi: number | null;
  score: number;
  signal: string;
  reason: string;
}

export interface EgxPosition {
  symbol: string;
  name: string;
  alertedAt: string;       // ISO when we sent the BUY alert
  alertPrice: number;      // price at the time of BUY alert
  lastScore: number;
  lastSignal: string;
  lastCheckedAt: string;
}

// ── EGX helpers ───────────────────────────────────────────────────────────────

/** Save a new alert to history (capped at 500) */
export async function logEgxAlert(alert: Omit<EgxAlert, "id">): Promise<void> {
  const r = getRedis();
  const full: EgxAlert = {
    ...alert,
    id: `${Date.now()}-${alert.symbol}`,
  };
  await r.lpush(KEYS.EGX_ALERTS, JSON.stringify(full));
  await r.ltrim(KEYS.EGX_ALERTS, 0, 499); // keep last 500 alerts
}

/** Get most recent EGX alerts */
export async function getEgxAlerts(limit = 50): Promise<EgxAlert[]> {
  const r = getRedis();
  const raw = await r.lrange(KEYS.EGX_ALERTS, 0, limit - 1);
  return raw.map(item => (typeof item === "string" ? JSON.parse(item) : item));
}

/** Save a stock position to portfolio (when we send a BUY alert) */
export async function saveEgxPosition(pos: EgxPosition): Promise<void> {
  await getRedis().hset(KEYS.EGX_PORTFOLIO, { [pos.symbol]: JSON.stringify(pos) });
}

/** Remove a stock from portfolio (when we send a SELL alert) */
export async function removeEgxPosition(symbol: string): Promise<void> {
  await getRedis().hdel(KEYS.EGX_PORTFOLIO, symbol);
}

/** Get all current EGX portfolio positions */
export async function getEgxPortfolio(): Promise<EgxPosition[]> {
  const r = getRedis();
  const raw = await r.hgetall(KEYS.EGX_PORTFOLIO);
  if (!raw) return [];
  return Object.values(raw).map(v => (typeof v === "string" ? JSON.parse(v) : v));
}

/** Check if a stock is in the portfolio (BUY alert already sent) */
export async function isInEgxPortfolio(symbol: string): Promise<boolean> {
  const raw = await getRedis().hget<string>(KEYS.EGX_PORTFOLIO, symbol);
  return raw !== null;
}

/** Set per-stock cooldown (to avoid spamming same alert twice) */
export async function setEgxCooldown(symbol: string, ttlSeconds: number): Promise<void> {
  await getRedis().set(KEYS.EGX_STOCK_COOLDOWN(symbol), "1", { ex: ttlSeconds });
}

/** Check if a stock is in cooldown */
export async function isEgxOnCooldown(symbol: string): Promise<boolean> {
  const val = await getRedis().get(KEYS.EGX_STOCK_COOLDOWN(symbol));
  return val !== null;
}

export interface ThndrPosition {
  symbol: string;
  buyPrice: number;
  shares: number;
}

/** Save Thndr portfolio */
export async function saveEgxThndrPortfolio(portfolio: ThndrPosition[]): Promise<void> {
  await getRedis().set(KEYS.EGX_THNDR_PORTFOLIO, JSON.stringify(portfolio));
}

/** Get Thndr portfolio */
export async function getEgxThndrPortfolio(): Promise<ThndrPosition[]> {
  const r = await getRedis().get<string>(KEYS.EGX_THNDR_PORTFOLIO);
  if (!r) return [];
  try {
    return typeof r === 'string' ? JSON.parse(r) : r;
  } catch {
    return [];
  }
}

