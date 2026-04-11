"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, TrendingUp, TrendingDown } from "lucide-react";

interface Trade {
  id: string;
  timestamp: string;
  action: "BUY" | "SELL";
  price: number;
  egp_amount: number;
  grams: number;
  profit: number;
  wallet_balance: number;
}

function fmt(n: number | null | undefined, d = 2) {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-EG", { minimumFractionDigits: d, maximumFractionDigits: d });
}

export default function TradesPage() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/trades?limit=500")
      .then(r => r.json())
      .then(d => { setTrades(d.trades ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const totalProfit = trades.filter(t => t.action === "SELL").reduce((s, t) => s + (t.profit ?? 0), 0);

  return (
    <div style={{ minHeight: "100vh", padding: "24px", maxWidth: "1100px", margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 32 }}>
        <a href="/" style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--gold-500)", textDecoration: "none", fontSize: 13 }}>
          <ArrowLeft size={15} /> Back to Dashboard
        </a>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>All Trades</h1>
      </div>

      {/* Summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 28 }}>
        <div className="glass-card" style={{ padding: "18px 22px" }}>
          <p className="stat-label" style={{ marginBottom: 6 }}>Total Trades</p>
          <p className="stat-value gold-value">{trades.length}</p>
        </div>
        <div className="glass-card" style={{ padding: "18px 22px" }}>
          <p className="stat-label" style={{ marginBottom: 6 }}>Total Profit</p>
          <p className="stat-value" style={{ color: totalProfit >= 0 ? "var(--green)" : "var(--red)" }}>
            {totalProfit >= 0 ? "+" : ""}{fmt(totalProfit)} EGP
          </p>
        </div>
        <div className="glass-card" style={{ padding: "18px 22px" }}>
          <p className="stat-label" style={{ marginBottom: 6 }}>Buy Trades</p>
          <p className="stat-value" style={{ color: "var(--gold-500)" }}>{trades.filter(t => t.action === "BUY").length}</p>
        </div>
        <div className="glass-card" style={{ padding: "18px 22px" }}>
          <p className="stat-label" style={{ marginBottom: 6 }}>Sell Trades</p>
          <p className="stat-value" style={{ color: "var(--green)" }}>{trades.filter(t => t.action === "SELL").length}</p>
        </div>
      </div>

      {/* Table */}
      <div className="glass-card" style={{ padding: 24, overflowX: "auto" }}>
        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[...Array(8)].map((_, i) => <div key={i} className="skeleton" style={{ height: 44, borderRadius: 8 }} />)}
          </div>
        ) : trades.length === 0 ? (
          <p style={{ color: "var(--text-muted)", textAlign: "center", padding: "40px 0", fontSize: 14 }}>
            No trades yet — the bot is watching the market.
          </p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {["Time", "Action", "Price (EGP/g)", "Amount (EGP)", "Grams", "Profit", "Wallet After"].map(h => (
                  <th key={h} style={{ padding: "10px 12px", textAlign: "left", color: "var(--text-muted)", fontWeight: 500, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trades.map((t, i) => (
                <tr key={t.id ?? i} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <td style={{ padding: "12px 12px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                    {new Date(t.timestamp).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td style={{ padding: "12px 12px" }}>
                    <span style={{
                      padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                      background: t.action === "BUY" ? "rgba(234,179,8,0.15)" : "rgba(34,197,94,0.15)",
                      color: t.action === "BUY" ? "var(--gold-400)" : "var(--green)",
                      border: `1px solid ${t.action === "BUY" ? "rgba(234,179,8,0.3)" : "rgba(34,197,94,0.3)"}`,
                    }}>{t.action}</span>
                  </td>
                  <td style={{ padding: "12px 12px", color: "var(--text-primary)", fontWeight: 500 }}>{fmt(t.price)}</td>
                  <td style={{ padding: "12px 12px", color: "var(--text-secondary)" }}>{fmt(t.egp_amount)}</td>
                  <td style={{ padding: "12px 12px", color: "var(--text-secondary)" }}>{(t.grams ?? 0).toFixed(6)}</td>
                  <td style={{ padding: "12px 12px" }}>
                    {t.action === "SELL" ? (
                      <span style={{ color: (t.profit ?? 0) >= 0 ? "var(--green)" : "var(--red)", fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
                        {(t.profit ?? 0) >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                        {(t.profit ?? 0) >= 0 ? "+" : ""}{fmt(t.profit)}
                      </span>
                    ) : (
                      <span style={{ color: "var(--text-muted)" }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: "12px 12px", color: "var(--text-muted)" }}>{fmt(t.wallet_balance)} EGP</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
