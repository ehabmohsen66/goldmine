import { NextResponse } from "next/server";
import {
  getState, saveState, isBotEnabled,
  logTrade, appendPrice, getRedis, KEYS, getPriceHistory,
  type BotState,
} from "@/lib/redis";
import { getGoldPrice, loginAndGetPortfolio } from "@/lib/scraper";
import {
  emailBought, emailSold, emailAddFunds,
  emailHoldingUpdate, emailError,
} from "@/lib/email";
import { analyzeMarket } from "@/lib/strategy";
import {
  telegramBuySignal, telegramSellSignal, telegramHoldAlert, telegramError, telegramInfo,
} from "@/lib/telegram";

export const runtime = "nodejs";
export const maxDuration = 60;

const BASE_DIP_PCT   = parseFloat(process.env.DIP_BUY_PCT        ?? "0.15"); // Lowered from 0.5% for highly active trading
const BASE_TRAIL_PCT = parseFloat(process.env.TRAIL_STOP_PCT      ?? "0.15"); // Lowered from 0.4% to lock in smaller, frequent profits
const LOW_WALLET     = parseFloat(process.env.LOW_WALLET_THRESHOLD ?? "10");
const DRY_RUN        = process.env.DRY_RUN === "true";

// DCA allocation: 3 tranches — 50% initial, 30% on deeper dip, 20% on deepest dip.
// This ensures we always have reserves for averaging down on bigger drops.
const DCA_TRANCHES = [0.5, 0.3, 0.2];

const CRON_SECRET = process.env.CRON_SECRET;
const dryTag = DRY_RUN ? "[DRY RUN] " : "";

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

    // ── 2. Auto-sync portfolio from MNGM every 2 min ─────────────────────────
    const lastWalletFetch = await r.get<string>("goldmine:last_wallet_fetch");
    const walletAge = lastWalletFetch ? now - parseInt(lastWalletFetch) : Infinity;
    if (state.wallet_balance === null || walletAge > 2 * 60 * 1000) {
      const portfolio = await loginAndGetPortfolio();
      if (portfolio !== null) {
        const prevWallet = state.wallet_balance ?? 0;
        const walletIncrease = portfolio.wallet - prevWallet;
        state.wallet_balance = portfolio.wallet;

        // ── Case A: Bot didn't know user was holding — auto-detect BUY ───────
        if (portfolio.grams > 0 && !state.in_position) {
          state.in_position   = true;
          state.grams_held    = portfolio.grams;
          state.buy_price     = price; // best estimate
          state.buy_time      = new Date().toISOString();
          state.peak_price    = state.peak_price ?? price;
          state.trailing_high = price;
          state.dca_level     = 1;
          // Log it so trade history is complete
          await logTrade({
            timestamp: new Date().toISOString(),
            action: "BUY",
            price,
            egp_amount: portfolio.grams * price,
            grams: portfolio.grams,
            profit: 0,
            wallet_balance: state.wallet_balance,
          });
          await telegramInfo(`🟢 <b>Manual buy detected!</b>\n\n<b>${portfolio.grams.toFixed(4)}g</b> @ ${price.toFixed(2)} EGP/g\nBot is now tracking your position & will alert you when to sell.`);
          console.log(`[tick] Auto-detected manual buy: ${portfolio.grams}g`);

        // ── Case B: Bot knew user was holding, now grams=0 → SELL ────────────
        } else if (portfolio.grams === 0 && state.in_position) {
          const alreadyConfirmed = await r.get<string>("goldmine:sell_confirmed");
          if (alreadyConfirmed) {
            await r.del("goldmine:sell_confirmed");
            console.log(`[tick] Sell already confirmed via dashboard — skipping duplicate log`);
          } else {
            const profit = state.buy_price && state.grams_held
              ? (price - state.buy_price) * state.grams_held
              : 0;
            const gramsWereHeld = state.grams_held ?? 0;
            state.total_profit = (state.total_profit ?? 0) + profit;
            state.trade_count  = (state.trade_count ?? 0) + 1;
            await logTrade({
              timestamp: new Date().toISOString(),
              action: "SELL",
              price,
              egp_amount: gramsWereHeld * price,
              grams: gramsWereHeld,
              profit,
              wallet_balance: state.wallet_balance,
            });
            console.log(`[tick] Auto-detected manual sell — profit: ${profit.toFixed(2)} EGP`);
            await telegramInfo(`✅ <b>Sell detected & synced!</b>\n\nProfit: <b>${profit >= 0 ? '+' : ''}${profit.toFixed(2)} EGP</b>\nWallet now: <b>${state.wallet_balance.toFixed(2)} EGP</b>\n\n<i>Bot is now watching for the next buy signal.</i>`);
          }
          // Reset position state
          state.in_position   = false;
          state.grams_held    = null;
          state.buy_price     = null;
          state.egp_invested  = null;
          state.buy_time      = null;
          state.trailing_high = null;
          state.dca_level     = 0;
          state.dca_reserved  = 0;
          state.peak_price    = price;
          await r.del("goldmine:last_sell_signal");

        // ── Case C: Bot had no position, grams=0, but wallet GREW → quick sell
        } else if (portfolio.grams === 0 && !state.in_position && walletIncrease > 50) {
          // User did a full buy+sell cycle the bot missed entirely
          state.trade_count = (state.trade_count ?? 0) + 1;
          const profit = walletIncrease; // net cash gain is the profit
          state.total_profit = (state.total_profit ?? 0) + profit;
          await logTrade({
            timestamp: new Date().toISOString(),
            action: "SELL",
            price,
            egp_amount: portfolio.wallet,
            grams: 0, // unknown since bot missed the position
            profit,
            wallet_balance: state.wallet_balance,
          });
          state.peak_price = price;
          await r.del("goldmine:last_sell_signal");
          console.log(`[tick] Detected missed buy+sell cycle — wallet grew by ${walletIncrease.toFixed(2)} EGP`);
          await telegramInfo(`✅ <b>Trade cycle detected!</b>\n\nNet gain: <b>+${profit.toFixed(2)} EGP</b>\nWallet now: <b>${state.wallet_balance.toFixed(2)} EGP</b>\n\n<i>Bot is now watching for the next buy signal.</i>`);

        } else if (portfolio.grams > 0) {
          // Still holding — keep grams in sync
          state.grams_held = portfolio.grams;
        }
      }
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

      const changePct    = ((price - state.buy_price) / state.buy_price) * 100;
      const trailDropPct = state.trailing_high > 0
        ? ((state.trailing_high - price) / state.trailing_high) * 100
        : 0;

      // Ensure we clear the MNGM ~1.0% spread fee! We must be up at least 1.3% gross to net a real profit.
      const MIN_PROFIT_PCT = parseFloat(process.env.MIN_PROFIT_PCT ?? "1.3");

      const trailTriggered   = trailDropPct >= adaptiveTrailPct && changePct >= MIN_PROFIT_PCT;
      const sellSignalStrong = signal.action === "SELL_STRONG" && changePct >= MIN_PROFIT_PCT;

      if (trailTriggered || sellSignalStrong) {
        const unrealizedProfit = (price - state.buy_price) * (state.grams_held ?? 0);

        // Rate-limit sell signals — only send once every 30 minutes
        const lastSellSignal = await r.get<string>("goldmine:last_sell_signal");
        const sellSignalAge  = lastSellSignal ? now - parseInt(lastSellSignal) : Infinity;
        const SELL_SIGNAL_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

        if (sellSignalAge >= SELL_SIGNAL_COOLDOWN_MS) {
          // 🔴 Send Telegram sell signal — user executes manually on MNGM
          await telegramSellSignal(state.buy_price, price, state.grams_held ?? 0, unrealizedProfit);
          await emailSold(state.buy_price, price, state.grams_held ?? 0, unrealizedProfit, state.wallet_balance ?? 0, state.trade_count ?? 0, state.total_profit ?? 0);
          await r.set("goldmine:last_sell_signal", String(now));
          console.log(`${dryTag}SELL SIGNAL sent — price: ${price}, unrealized: ${unrealizedProfit.toFixed(2)} EGP`);
        } else {
          console.log(`[tick] Sell signal suppressed — cooldown active (${Math.round(sellSignalAge / 60000)}m elapsed, 30m cooldown)`);
        }
        // State is updated by portfolio auto-sync (detects grams=0) or via POST /api/bot/confirm

      } else if (changePct < -2.0) {
        const lastAlert = await r.get<string>(KEYS.LAST_HOLDING_ALERT);
        if (!lastAlert || now - parseInt(lastAlert) > 21600000) {
          await emailHoldingUpdate(state.buy_price, price, state.grams_held, changePct);
          await r.set(KEYS.LAST_HOLDING_ALERT, String(now));
        }
      }

    // ── 5. WATCHING — DCA buy strategy ───────────────────────────────────────
    } else {
      // Decay stale peak: if the peak was set more than 7 days ago with no trade,
      // reset it to the current price. A frozen historical peak causes a permanently
      // large "dip%" which either fires buy signals non-stop or masks real dips.
      const lastTradeOrBoot = state.buy_time
        ? new Date(state.buy_time).getTime()
        : now - (8 * 24 * 3600 * 1000); // assume stale if no trade time recorded
      const peakAgeMs = now - lastTradeOrBoot;
      const PEAK_DECAY_MS = 7 * 24 * 3600 * 1000; // 7 days

      if (state.peak_price !== null && peakAgeMs > PEAK_DECAY_MS) {
        console.log(`[tick] Peak decayed — was ${state.peak_price.toFixed(2)}, resetting to ${price.toFixed(2)}`);
        state.peak_price = price;
      }

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

      // Smart Momentum Ride: if the market is trending up strongly and RSI is healthy, get in!
      const momentumRide = signal.momentumBuy && state.dca_level === 0;

      const shouldBuy = level1Hit || level2Hit || level3Hit || rsiOverride || momentumRide;

      if (shouldBuy) {
        const wallet = state.wallet_balance ?? 0;

        // Determine how much to invest in this tranche
        let investPct: number;
        if (state.dca_level === 0) {
          investPct = (rsiOverride || momentumRide) ? 1.0 : DCA_TRANCHES[0];
        } else {
          investPct = DCA_TRANCHES[Math.min(state.dca_level, DCA_TRANCHES.length - 1)];
        }

        const totalBudget  = wallet + state.dca_reserved;
        const investAmount = state.dca_level === 0
          ? totalBudget * investPct
          : state.dca_reserved * investPct;

        if (investAmount >= LOW_WALLET) {
          // 🟢 Send Telegram buy signal — user executes manually
          await telegramBuySignal(price, investAmount, dipPct, wallet);
          await emailBought(price, investAmount / price, investAmount, (state.trade_count ?? 0) + 1);
          console.log(`${dryTag}BUY SIGNAL sent — price: ${price}, amount: ${investAmount.toFixed(2)} EGP`);

          // Save pending signal so /confirm_buy can update state
          await r.set("goldmine:pending_buy", JSON.stringify({ price, investAmount, investPct, dipPct, rsiOverride, dca_level: state.dca_level }));

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
    return NextResponse.json({ ok: true, dry_run: DRY_RUN, price, signal, state });

  } catch (err) {
    const errStr = String(err);
    state.status     = "error";
    state.last_error = errStr;
    await saveState(state);
    await emailError(errStr);
    return NextResponse.json({ error: errStr }, { status: 500 });
  }
}
