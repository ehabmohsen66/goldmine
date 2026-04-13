"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  TrendingUp, TrendingDown, Activity, Wallet,
  BarChart3, RefreshCw, Play, Square, ChevronRight,
  Zap, AlertTriangle, Clock, CheckCircle, RotateCcw,
} from "lucide-react";

const PriceChart = dynamic(() => import("@/components/PriceChart"), { ssr: false });
const TradeTable = dynamic(() => import("@/components/TradeTable"), { ssr: false });

interface BotState {
  in_position: boolean;
  buy_price: number | null;
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
  bot_enabled: boolean;
  price_history: Array<{ t: number; p: number }>;
}

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-EG", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function timeSince(iso: string | null): string {
  if (!iso) return "—";
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

export default function DashboardPage() {
  const [state, setState] = useState<BotState | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [trades, setTrades] = useState<unknown[]>([]);
  const [confirmMsg, setConfirmMsg] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/bot/status");
      if (res.ok) setState(await res.json());
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  const fetchTrades = useCallback(async () => {
    try {
      const res = await fetch("/api/trades?limit=20");
      if (res.ok) {
        const data = await res.json();
        setTrades(data.trades ?? []);
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchTrades();
    const interval = setInterval(() => { fetchStatus(); fetchTrades(); }, 30000);
    return () => clearInterval(interval);
  }, [fetchStatus, fetchTrades]);

  const handleStart = async () => {
    setActionLoading(true);
    await fetch("/api/bot/start", { method: "POST" });
    await fetchStatus();
    setActionLoading(false);
  };

  const handleStop = async () => {
    setActionLoading(true);
    await fetch("/api/bot/stop", { method: "POST" });
    await fetchStatus();
    setActionLoading(false);
  };

  // ── Confirm Sell: tell the bot you already sold manually ─────────────────
  const handleConfirmSell = async () => {
    if (!state?.grams_held || !state?.last_price) return;
    setActionLoading(true);
    try {
      const res = await fetch("/api/bot/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sell",
          price: state.last_price,
          grams: state.grams_held,
          egp_amount: state.grams_held * state.last_price,
          wallet_balance: (state.wallet_balance ?? 0) + state.grams_held * state.last_price,
        }),
      });
      if (res.ok) {
        setConfirmMsg("✅ Sell confirmed! Bot state reset. Now watching for buy signals.");
        await fetchStatus();
        await fetchTrades();
      } else {
        setConfirmMsg("❌ Failed to confirm sell — check console.");
      }
    } catch (e) {
      setConfirmMsg("❌ Network error.");
    } finally {
      setActionLoading(false);
      setTimeout(() => setConfirmMsg(null), 6000);
    }
  };

  // ── Force Sync: clear wallet fetch timestamp so next tick re-syncs ASAP ──
  const handleForceSync = async () => {
    setActionLoading(true);
    try {
      // Patch state to clear the throttle timestamp via sync endpoint
      await fetch("/api/bot/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      setConfirmMsg("🔄 Sync requested — portfolio will update on the next cron tick (≤60s).");
    } catch {
      setConfirmMsg("❌ Sync request failed.");
    } finally {
      setActionLoading(false);
      setTimeout(() => setConfirmMsg(null), 6000);
    }
  };

  const pnlPct = state?.in_position && state.buy_price && state.last_price
    ? ((state.last_price - state.buy_price) / state.buy_price) * 100
    : null;

  const unrealizedEgp = state?.in_position && state.buy_price && state.last_price && state.grams_held
    ? (state.last_price - state.buy_price) * state.grams_held
    : null;

  const isRunning = state?.status === "running" && state?.bot_enabled;
  const isError   = state?.status === "error";

  return (
    <div style={{ minHeight: "100vh", padding: "24px", maxWidth: "1280px", margin: "0 auto" }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "32px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {/* Gold bar icon */}
          <div style={{
            width: 42, height: 42, borderRadius: 12,
            background: "linear-gradient(135deg, #CA8A04 0%, #EAB308 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 0 20px rgba(202,138,4,0.4)",
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="8" width="20" height="8" rx="2"/>
              <path d="M6 8V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2"/>
              <line x1="12" y1="12" x2="12" y2="12"/>
            </svg>
          </div>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "#FAFAF9", letterSpacing: "-0.02em" }}>
              Goldmine
            </h1>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 1 }}>
              mngm.com Autonomous Trading Bot
            </p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {/* Status badge */}
          {loading ? (
            <div className="skeleton" style={{ width: 90, height: 28 }} />
          ) : (
            <span className={isError ? "badge-error" : isRunning ? "badge-running" : "badge-stopped"}>
              <span className="pulse-dot" />
              {isError ? "Error" : isRunning ? "Running" : "Stopped"}
            </span>
          )}

          {/* EGX link */}
          <Link href="/egx" style={{ textDecoration: "none" }}>
            <button
              className="btn-ghost"
              style={{ padding: "8px 12px", display: "flex", alignItems: "center", gap: 6 }}
            >
              <BarChart3 size={14} />
              <span style={{ fontSize: 13 }}>البورصة</span>
            </button>
          </Link>

          {/* Refresh */}
          <button
            className="btn-ghost"
            onClick={() => { fetchStatus(); fetchTrades(); }}
            style={{ padding: "8px 12px", display: "flex", alignItems: "center", gap: 6 }}
          >
            <RefreshCw size={14} />
            <span style={{ fontSize: 13 }}>Refresh</span>
          </button>

          {/* Start / Stop */}
          {state?.bot_enabled ? (
            <button className="btn-danger" onClick={handleStop} disabled={actionLoading}
              style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Square size={13} />
              {actionLoading ? "Stopping…" : "Stop Bot"}
            </button>
          ) : (
            <button className="btn-gold" onClick={handleStart} disabled={actionLoading}
              style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Play size={13} />
              {actionLoading ? "Starting…" : "Start Bot"}
            </button>
          )}
        </div>
      </div>

      {/* ── Confirm Sell Banner — appears when bot thinks you're holding ───── */}
      {state?.in_position && (
        <div style={{
          marginBottom: 20, padding: "14px 20px", borderRadius: 14,
          background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.3)",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <AlertTriangle size={16} color="#EAB308" style={{ flexShrink: 0 }} />
            <p style={{ fontSize: 13, color: "#EAB308", fontWeight: 500 }}>
              Bot thinks you&apos;re holding <b>{(state.grams_held ?? 0).toFixed(4)}g</b>.
              If you already sold manually on MNGM, click <b>Confirm Sell</b>.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <button
              className="btn-ghost"
              onClick={handleForceSync}
              disabled={actionLoading}
              title="Force MNGM portfolio sync on next cron tick"
              style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12 }}
            >
              <RotateCcw size={12} />
              Force Sync
            </button>
            <button
              onClick={handleConfirmSell}
              disabled={actionLoading}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "7px 14px", borderRadius: 8, fontSize: 13, fontWeight: 600,
                background: "linear-gradient(135deg, #EAB308, #CA8A04)",
                color: "#000", border: "none", cursor: "pointer",
              }}
            >
              <CheckCircle size={13} />
              {actionLoading ? "Confirming…" : "I Sold — Confirm"}
            </button>
          </div>
        </div>
      )}

      {/* ── Action feedback message ────────────────────────────────────────── */}
      {confirmMsg && (
        <div style={{
          marginBottom: 20, padding: "12px 16px", borderRadius: 12,
          background: confirmMsg.startsWith("✅") ? "rgba(34,197,94,0.08)" : confirmMsg.startsWith("🔄") ? "rgba(59,130,246,0.08)" : "rgba(239,68,68,0.08)",
          border: `1px solid ${confirmMsg.startsWith("✅") ? "rgba(34,197,94,0.2)" : confirmMsg.startsWith("🔄") ? "rgba(59,130,246,0.2)" : "rgba(239,68,68,0.2)"}`,
          fontSize: 13, color: confirmMsg.startsWith("✅") ? "#22C55E" : confirmMsg.startsWith("🔄") ? "#60A5FA" : "#EF4444",
        }}>
          {confirmMsg}
        </div>
      )}

      {/* ── Error Banner ───────────────────────────────────────────────────── */}
      {isError && state?.last_error && (
        <div style={{
          marginBottom: 24, padding: "12px 16px", borderRadius: 12,
          background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)",
          display: "flex", alignItems: "flex-start", gap: 10,
        }}>
          <AlertTriangle size={16} color="#EF4444" style={{ marginTop: 1, flexShrink: 0 }} />
          <p style={{ fontSize: 13, color: "#EF4444", fontFamily: "monospace", wordBreak: "break-all" }}>
            {state.last_error}
          </p>
        </div>
      )}

      {/* ── Live Price Ticker ──────────────────────────────────────────────── */}
      <div className="glass-card" style={{ padding: "28px 32px", marginBottom: 20, textAlign: "center" }}>
        <p className="stat-label" style={{ marginBottom: 8 }}>Live Gold Price</p>
        {loading ? (
          <div className="skeleton" style={{ width: 260, height: 52, margin: "0 auto" }} />
        ) : (
          <div className="price-ticker">
            {fmt(state?.last_price, 2)}
            <span style={{ fontSize: 20, color: "var(--text-muted)", marginLeft: 8 }}>EGP/g</span>
          </div>
        )}
        {state?.last_tick && (
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
            <Clock size={11} /> Updated {timeSince(state.last_tick)}
          </p>
        )}
      </div>

      {/* ── Stat Cards Row ─────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginBottom: 20 }}>

        {/* Wallet */}
        <div className="glass-card" style={{ padding: "20px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <p className="stat-label">Wallet Balance</p>
            <Wallet size={16} color="var(--text-muted)" />
          </div>
          {loading ? <div className="skeleton" style={{ width: 130, height: 32 }} /> : (
            <p className="stat-value gold-value">{fmt(state?.wallet_balance)} <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-muted)" }}>EGP</span></p>
          )}
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
            {state?.in_position ? "Deployed in position" : "Available to invest"}
          </p>
        </div>

        {/* Total Profit */}
        <div className="glass-card" style={{ padding: "20px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <p className="stat-label">Total Profit</p>
            <TrendingUp size={16} color="var(--green)" />
          </div>
          {loading ? <div className="skeleton" style={{ width: 120, height: 32 }} /> : (
            <p className="stat-value" style={{ color: (state?.total_profit ?? 0) >= 0 ? "var(--green)" : "var(--red)" }}>
              {(state?.total_profit ?? 0) >= 0 ? "+" : ""}{fmt(state?.total_profit)} <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-muted)" }}>EGP</span>
            </p>
          )}
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
            {state?.trade_count ?? 0} completed trades
          </p>
        </div>

        {/* Current Position */}
        <div className="glass-card" style={{ padding: "20px 24px", borderColor: state?.in_position ? "rgba(234,179,8,0.25)" : undefined }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <p className="stat-label">Position</p>
            <Activity size={16} color={state?.in_position ? "var(--gold-500)" : "var(--text-muted)"} />
          </div>
          {loading ? <div className="skeleton" style={{ width: 100, height: 32 }} /> : state?.in_position ? (
            <>
              <p className="stat-value gold-value">{(state?.grams_held ?? 0).toFixed(4)} <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-muted)" }}>g</span></p>
              <p style={{ fontSize: 12, marginTop: 6 }}>
                <span style={{ color: "var(--text-muted)" }}>Bought @ </span>
                <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{fmt(state?.buy_price)} EGP/g</span>
              </p>
            </>
          ) : (
            <>
              <p className="stat-value" style={{ color: "var(--text-muted)", fontSize: 20 }}>No position</p>
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>Watching for dip…</p>
            </>
          )}
        </div>

        {/* P/L on current position */}
        <div className="glass-card" style={{ padding: "20px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <p className="stat-label">Unrealized P/L</p>
            {pnlPct !== null && pnlPct >= 0
              ? <TrendingUp size={16} color="var(--green)" />
              : <TrendingDown size={16} color={pnlPct === null ? "var(--text-muted)" : "var(--red)"} />}
          </div>
          {loading ? <div className="skeleton" style={{ width: 110, height: 32 }} /> : (
            <p className="stat-value" style={{ color: pnlPct === null ? "var(--text-muted)" : pnlPct >= 0 ? "var(--green)" : "var(--red)" }}>
              {pnlPct !== null ? `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%` : "—"}
            </p>
          )}
          {unrealizedEgp !== null && (
            <p style={{ fontSize: 13, fontWeight: 600, marginTop: 4, color: unrealizedEgp >= 0 ? "var(--green)" : "var(--red)" }}>
              {unrealizedEgp >= 0 ? "+" : ""}{fmt(unrealizedEgp)} EGP
            </p>
          )}
          {state?.in_position && state?.buy_price && (
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
              Target: +{process.env.NEXT_PUBLIC_SELL_TARGET_PCT ?? "0.7"}%
            </p>
          )}
        </div>

        {/* Peak Price */}
        <div className="glass-card" style={{ padding: "20px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <p className="stat-label">Rolling Peak</p>
            <BarChart3 size={16} color="var(--text-muted)" />
          </div>
          {loading ? <div className="skeleton" style={{ width: 130, height: 32 }} /> : (
            <p className="stat-value" style={{ color: "var(--text-primary)" }}>
              {fmt(state?.peak_price)} <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-muted)" }}>EGP/g</span>
            </p>
          )}
          {state?.peak_price && state?.last_price && (
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
              Dip: {(((state.peak_price - state.last_price) / state.peak_price) * 100).toFixed(2)}% from peak
            </p>
          )}
        </div>

      </div>

      {/* ── Price Chart ────────────────────────────────────────────────────── */}
      <div className="glass-card" style={{ padding: "24px", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>Price History</h2>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Last 2 hours · refreshes every 30s</span>
        </div>
        {loading ? (
          <div className="skeleton" style={{ height: 240 }} />
        ) : (
          <PriceChart
            data={state?.price_history ?? []}
            buyPrice={state?.buy_price ?? undefined}
          />
        )}
      </div>

      {/* ── Trade History ──────────────────────────────────────────────────── */}
      <div className="glass-card" style={{ padding: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>Recent Trades</h2>
          <a href="/trades" style={{ fontSize: 12, color: "var(--gold-500)", textDecoration: "none", display: "flex", alignItems: "center", gap: 3, cursor: "pointer" }}>
            View all <ChevronRight size={13} />
          </a>
        </div>
        <TradeTable trades={trades as never[]} />
      </div>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <div style={{ marginTop: 24, textAlign: "center" }}>
        <p style={{ fontSize: 11, color: "var(--text-muted)" }}>
          <Zap size={10} style={{ display: "inline", marginRight: 4 }} />
          Goldmine runs on Railway · checks price every 60s · powered by mngm.com
        </p>
      </div>

    </div>
  );
}
