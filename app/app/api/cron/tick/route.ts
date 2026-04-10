import { NextResponse } from "next/server";
import {
  getState, saveState, isBotEnabled,
  logTrade, appendPrice, getRedis, KEYS,
  type BotState,
} from "@/lib/redis";
import {
  getGoldPrice, loginAndGetWallet, executeBuy, executeSell,
} from "@/lib/scraper";
import {
  emailBought, emailSold, emailAddFunds,
  emailHoldingUpdate, emailError,
} from "@/lib/email";

export const runtime = "nodejs";
export const maxDuration = 60; // 1 min max for Vercel Hobby

const SELL_TARGET_PCT = parseFloat(process.env.SELL_TARGET_PCT ?? "0.7");
const DIP_BUY_PCT     = parseFloat(process.env.DIP_BUY_PCT ?? "0.5");
const LOW_WALLET      = parseFloat(process.env.LOW_WALLET_THRESHOLD ?? "500");

// Vercel Cron secret check
const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(request: Request) {
  // Verify cron secret to prevent public invocation
  if (CRON_SECRET) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Check if bot is enabled
  const enabled = await isBotEnabled();
  if (!enabled) {
    return NextResponse.json({ skipped: true, reason: "Bot is disabled" });
  }

  const state: BotState = await getState();
  const r = getRedis();
  const now = Date.now();

  try {
    // ── 1. Get live gold price ───────────────────────────────────────────────
    const price = await getGoldPrice();
    state.last_price = price;
    state.last_tick = new Date().toISOString();
    state.status = "running";
    state.last_error = null;

    // ── 1b. Get initial wallet balance if missing ────────────────────────────
    if (state.wallet_balance === null && !state.in_position) {
      state.wallet_balance = (await loginAndGetWallet()) ?? 0;
    }

    await appendPrice(price);

    // ── 2. IN POSITION — check sell trigger ──────────────────────────────────
    if (state.in_position && state.buy_price !== null && state.grams_held !== null) {
      const changePct = ((price - state.buy_price) / state.buy_price) * 100;

      if (changePct >= SELL_TARGET_PCT) {
        // SELL
        await executeSell(state.grams_held);
        await new Promise((r) => setTimeout(r, 15000));

        const sellValue = state.grams_held * price;
        const egpIn     = state.egp_invested ?? sellValue;
        const profit    = sellValue - egpIn;

        state.total_profit += profit;
        state.trade_count  += 1;
        state.in_position   = false;
        state.peak_price    = price;

        const wallet = (await loginAndGetWallet()) ?? sellValue;
        state.wallet_balance = wallet;
        state.buy_price      = null;
        state.grams_held     = null;
        state.egp_invested   = null;

        await saveState(state);
        await logTrade({
          timestamp: new Date().toISOString(),
          action: "SELL",
          price,
          egp_amount: sellValue,
          grams: state.grams_held ?? 0,
          profit,
          wallet_balance: wallet,
        });
        await emailSold(
          state.buy_price ?? price, price,
          state.grams_held ?? 0, profit,
          wallet, state.trade_count, state.total_profit,
        );

      } else if (changePct < -2.0) {
        // Send holding alert max once per 6h
        const lastAlert = await r.get<string>(KEYS.LAST_HOLDING_ALERT);
        if (!lastAlert || now - parseInt(lastAlert) > 21600000) {
          await emailHoldingUpdate(state.buy_price, price, state.grams_held, changePct);
          await r.set(KEYS.LAST_HOLDING_ALERT, String(now));
        }
      }

    // ── 3. WATCHING — check dip trigger ─────────────────────────────────────
    } else {
      // Update rolling peak
      if (state.peak_price === null || price > state.peak_price) {
        state.peak_price = price;
      }

      const dipPct = ((state.peak_price - price) / state.peak_price) * 100;

      if (dipPct >= DIP_BUY_PCT) {
        // Get wallet balance
        const wallet = (await loginAndGetWallet()) ?? state.wallet_balance ?? 0;
        state.wallet_balance = wallet;

        if (wallet >= LOW_WALLET) {
          // BUY
          await executeBuy(wallet);
          await new Promise((r) => setTimeout(r, 10000));

          const gramsAcquired   = wallet / price;
          state.in_position     = true;
          state.buy_price       = price;
          state.buy_time        = new Date().toISOString();
          state.grams_held      = gramsAcquired;
          state.egp_invested    = wallet;
          state.wallet_balance  = 0;
          state.peak_price      = price;

          await saveState(state);
          await logTrade({
            timestamp: new Date().toISOString(),
            action: "BUY",
            price,
            egp_amount: wallet,
            grams: gramsAcquired,
            profit: 0,
            wallet_balance: 0,
          });
          await emailBought(price, gramsAcquired, wallet, state.trade_count + 1);

        } else {
          // Wallet too low — alert (max once per hour)
          const lastAlert = await r.get<string>(KEYS.LAST_ADD_FUNDS_ALERT);
          if (!lastAlert || now - parseInt(lastAlert) > 3600000) {
            await emailAddFunds(price, wallet, dipPct, state.peak_price);
            await r.set(KEYS.LAST_ADD_FUNDS_ALERT, String(now));
          }
        }
      }
    }

    await saveState(state);
    return NextResponse.json({ ok: true, price, state });

  } catch (err) {
    const errStr = String(err);
    state.status = "error";
    state.last_error = errStr;
    await saveState(state);
    await emailError(errStr);
    return NextResponse.json({ error: errStr }, { status: 500 });
  }
}
