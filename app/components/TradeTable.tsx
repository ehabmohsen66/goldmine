"use client";

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

interface Props {
  trades: Trade[];
}

function fmt(n: number, d = 2) {
  return n.toLocaleString("en-EG", { minimumFractionDigits: d, maximumFractionDigits: d });
}

export default function TradeTable({ trades }: Props) {
  if (trades.length === 0) {
    return (
      <div style={{ padding: "32px", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
        No trades yet — bot will log every BUY and SELL here
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="data-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Action</th>
            <th>Price (EGP/g)</th>
            <th>Amount (EGP)</th>
            <th>Grams</th>
            <th>Profit</th>
            <th>Wallet</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => (
            <tr key={t.id}>
              <td style={{ color: "var(--text-muted)", fontSize: 12 }}>
                {new Date(t.timestamp).toLocaleString("en-EG", {
                  month: "short", day: "numeric",
                  hour: "2-digit", minute: "2-digit",
                })}
              </td>
              <td>
                <span style={{
                  display: "inline-block",
                  padding: "2px 10px",
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  background: t.action === "BUY" ? "rgba(234,179,8,0.1)" : "rgba(34,197,94,0.1)",
                  color: t.action === "BUY" ? "#EAB308" : "#22C55E",
                  border: `1px solid ${t.action === "BUY" ? "rgba(234,179,8,0.25)" : "rgba(34,197,94,0.25)"}`,
                }}>
                  {t.action}
                </span>
              </td>
              <td style={{ color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>
                {fmt(t.price)}
              </td>
              <td style={{ fontVariantNumeric: "tabular-nums" }}>
                {fmt(t.egp_amount)}
              </td>
              <td style={{ fontVariantNumeric: "tabular-nums", fontSize: 12 }}>
                {t.grams.toFixed(6)}
              </td>
              <td style={{
                fontVariantNumeric: "tabular-nums",
                fontWeight: 600,
                color: t.profit > 0 ? "var(--green)" : t.profit < 0 ? "var(--red)" : "var(--text-muted)",
              }}>
                {t.profit > 0 ? "+" : ""}{fmt(t.profit)}
              </td>
              <td style={{ fontVariantNumeric: "tabular-nums" }}>
                {fmt(t.wallet_balance)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
