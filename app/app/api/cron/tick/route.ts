import { NextResponse } from "next/server";
import {
  getState, saveState, isBotEnabled,
  logTrade, appendPrice, getRedis, KEYS, getPriceHistory,
  type BotState,
} from "@/lib/redis";
import {
  getGoldPrice, loginAndGetWallet, executeBuy, executeSell,
} from "@/lib/scraper";
import {
  emailBought, emailSold, emailAddFunds,
  emailHoldingUpdate, emailError,
} from "@/lib/email";
import { analyzeMarket } from "@/lib/strategy";

export const runtime = "nodejs";
export const maxDuration = 60;

const BASE_DIP_PCT   = parseFloat(process.env.DIP_BUY_PCT      ?? "0.5");
const BASE_TRAIL_PCT = parseFloat(process.env.TRAIL_STOP_PCT    ?? "0.4");
const LOW_WALLET     = parseFloat(process.env.LOW_WALLET_THRESHOLD ?? "500");

// DCA allocation: invest in 3 tranches — 40% / 40% / 20%
const DCA_TRANCHES = [0.4, 0.4, 0.2];

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: Request) {
  if (CRON_SECRET) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const enabled = await isBotEnabled();
  if (!enabled) return NextResponse.json({ skipped: true, reason: "Bot is disabled" });

  const state: BotState = await getState();
  // Backfill new fields for existing state objects
  if (state.trailing_high === undefined) state.trailing_high = null;
  if (state.dca_level === undefined) state.dca_level = 0;
  if (state.dca_reserved === undefined) state.dca_reserved = 0;

  const r = getRedis();
  const now = Date.now();

  try {
    // ── 1. Live price ────────────────────────────────────────────────────────
    const price = await getGoldPrice();
    state.last_price = price;
    state.last_tick  = new Date().toISOString();
    state.status     = "running";
    state.last_error = null;
    await appendPrice(price);

    // ── 2. Refresh wallet every 10 min ────────────────────────────────────────
    const lastWalletFetch = await r.get<string>("goldmine:last_wallet_fetch");
    const walletAge = lastWalletFetch ? now - parseInt(lastWalletFetch) : Infinity;
    if (state.wallet_balance === null || walletAge > 10 * 60 * 1000) {
      const w = await loginAndGetWallet();
      if (w !== null) state.wallet_balance = w;
      await r.set("goldmine:last_wallet_fetch", String(now));
    }

    // ── 3. Market analysis ───────────────────────────────────────────────────
    const history = await getPriceHistory(120);
    const signal  = analyzeMarket(
      [...(history ?? []), { t: now, p: price }],
      BASE_DIP_PCT,
      BASE_TRAIL_PCT
    );
    const { adaptiveDipPct, adaptiveTrailPct } = signal;

    // ── 4. IN POSITION — trailing stop + strong sell signal ──────────────────
    if (state.in_position && state.buy_price !== null && state.grams_held !== null) {

      // Update trailing high
      if (state.trailing_high === null || price > state.trailing_high) {
        state.trailing_high = price;
      }

      const changePct   = ((price - state.buy_price) / state.buy_price) * 100;
      const trailDropPct = state.trailing_high > 0
        ? ((state.trailing_high - price) / state.trailing_high) * 100
        : 0;

      const trailTriggered  = trailDropPct >= adaptiveTrailPct && changePct > 0; // must be profitable
      const sellSignalStrong = signal.action === "SELL_STRONG" && changePct > 0;

      if (trailTriggered || sellSignalStrong) {
        // SELL ALL
        await executeSell(state.grams_held);
        await new Promise(res => setTimeout(res, 12000));

        const sellValue = state.grams_held * price;
        const profit    = sellValue - (state.egp_invested ?? sellValue);

        state.total_profit  += profit;
        state.trade_count   += 1;
        state.in_position    = false;
        state.peak_price     = price;
        state.trailing_high  = null;
        state.dca_level      = 0;
        state.dca_reserved   = 0;

        const wallet = (await loginAndGetWallet()) ?? sellValue;
        state.wallet_balance = wallet;
        state.buy_price      = null;
        state.grams_held     = null;
        state.egp_invested   = null;

        await saveState(state);
        await logTrade({ timestamp: new Date().toISOString(), action: "SELL", price, egp_amount: sellValue, grams: state.grams_held ?? 0, profit, wallet_balance: wallet });
        await emailSold(state.buy_price ?? price, price, state.grams_held ?? 0, profit, wallet, state.trade_count, state.total_profit);

      } else if (changePct < -2.0) {
        const lastAlert = await r.get<string>(KEYS.LAST_HOLDING_ALERT);
        if (!lastAlert || now - parseInt(lastAlert) > 21600000) {
          await emailHoldingUpdate(state.buy_price, price, state.grams_held, changePct);
          await r.set(KEYS.LAST_HOLDING_ALERT, String(now));
        }
      }

    // ── 5. WATCHING — DCA buy strategy ───────────────────────────────────────
    } else {
      if (state.peak_price === null || price > state.peak_price) {
        state.peak_price = price;
      }

      const dipPct = ((state.peak_price - price) / state.peak_price) * 100;

      // Level 1 dip: buy first tranche
      const level1Hit = dipPct >= adaptiveDipPct && state.dca_level === 0;
      // Level 2 dip: buy second tranche (dip is 2x deeper)
      const level2Hit = dipPct >= adaptiveDipPct * 2 && state.dca_level === 1;
      // Level 3 dip: buy remaining reserve
      const level3Hit = dipPct >= adaptiveDipPct * 3 && state.dca_level === 2;
      // Strong RSI oversold — buy immediately regardless
      const rsiOverride = signal.action === "BUY_STRONG" && state.dca_level === 0;

      const shouldBuy = level1Hit || level2Hit || level3Hit || rsiOverride;

      if (shouldBuy) {
        const wallet = (await loginAndGetWallet()) ?? state.wallet_balance ?? 0;
        state.wallet_balance = wallet;

        // Determine how much to invest in this tranche
        let investPct: number;
        if (state.dca_level === 0) {
          investPct = rsiOverride ? 0.8 : DCA_TRANCHES[0]; // RSI override = 80% immediately
        } else {
          investPct = DCA_TRANCHES[Math.min(state.dca_level, DCA_TRANCHES.length - 1)];
        }

        const totalBudget  = wallet + state.dca_reserved;
        const investAmount = state.dca_level === 0
          ? totalBudget * investPct
          : state.dca_reserved * investPct;

        if (investAmount >= LOW_WALLET) {
          await executeBuy(investAmount);
          await new Promise(res => setTimeout(res, 8000));

          const gramsAcquired = investAmount / price;
          state.in_position   = true;
          state.buy_price     = state.buy_price
            // Weighted average buy price across DCA levels
            ? (state.buy_price * (state.grams_held ?? 0) + price * gramsAcquired) / ((state.grams_held ?? 0) + gramsAcquired)
            : price;
          state.buy_time      = state.buy_time ?? new Date().toISOString();
          state.grams_held    = (state.grams_held ?? 0) + gramsAcquired;
          state.egp_invested  = (state.egp_invested ?? 0) + investAmount;
          state.trailing_high = price;
          state.peak_price    = price;

          // Reserve the rest for deeper dip tranches
          if (state.dca_level === 0) {
            state.dca_reserved = totalBudget - investAmount;
          } else {
            state.dca_reserved = state.dca_reserved - (state.dca_reserved * investPct);
          }
          state.dca_level    += 1;
          state.wallet_balance = Math.max(0, wallet - investAmount);

          await saveState(state);
          await logTrade({ timestamp: new Date().toISOString(), action: "BUY", price, egp_amount: investAmount, grams: gramsAcquired, profit: 0, wallet_balance: state.wallet_balance });
          await emailBought(price, gramsAcquired, investAmount, state.trade_count + 1);

        } else {
          const lastAlert = await r.get<string>(KEYS.LAST_ADD_FUNDS_ALERT);
          if (!lastAlert || now - parseInt(lastAlert) > 3600000) {
            await emailAddFunds(price, wallet, dipPct, state.peak_price);
            await r.set(KEYS.LAST_ADD_FUNDS_ALERT, String(now));
          }
        }
      }
    }

    await saveState(state);
    return NextResponse.json({ ok: true, price, signal, state });

  } catch (err) {
    const errStr = String(err);
    state.status     = "error";
    state.last_error = errStr;
    await saveState(state);
    await emailError(errStr);
    return NextResponse.json({ error: errStr }, { status: 500 });
  }
}
