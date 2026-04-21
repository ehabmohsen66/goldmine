"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  TrendingUp, TrendingDown, RefreshCw, BarChart3,
  Activity, AlertTriangle, ChevronLeft, Zap, Clock,
  ArrowUpRight, ArrowDownRight, Briefcase, Bell, BrainCircuit, X,
  Brain, CheckCircle2, XCircle, Target, Sparkles, TrendingUp as TrendUp,
  DollarSign, Trophy, Percent
} from "lucide-react";
import dynamic from "next/dynamic";

const Chart = dynamic(() => import("react-apexcharts"), { ssr: false });



interface EgxStock {
  symbol: string;
  name: string;
  price: number;
  change: number;
  rsi: number | null;
  score: number;
  signal: "STRONG_BUY" | "BUY" | "HOLD" | "SELL" | "STRONG_SELL";
  sector: string | null;
  macd: number | null;
  macdSignal: number | null;
}

interface EgxAlert {
  id: string;
  timestamp: string;
  symbol: string;
  name: string;
  action: "BUY" | "SELL" | "WATCH";
  price: number;
  change: number;
  rsi: number | null;
  score: number;
  signal: string;
  reason: string;
}

interface EgxPosition {
  symbol: string;
  name: string;
  alertedAt: string;
  alertPrice: number;
  lastScore: number;
  lastSignal: string;
  lastCheckedAt: string;
}

interface EgxBriefResponse {
  overview: {
    topBuys: EgxStock[];
    topGainers: EgxStock[];
    topLosers: EgxStock[];
    watchlist: EgxStock[];
    bullishCount: number;
    bearishCount: number;
    neutralCount: number;
    totalScanned: number;
  } | null;
  portfolio: EgxPosition[];
  thndrPortfolio?: { symbol: string; buyPrice: number; shares: number }[];
  alerts: EgxAlert[];
  marketStatus: { open: boolean; reason: string } | null;
  lastScan: string | null;
  cachedAt: number;
  error?: string;
}

function signalColor(signal: string): string {
  if (signal === "STRONG_BUY") return "#22C55E";
  if (signal === "BUY")        return "#86EFAC";
  if (signal === "HOLD")       return "#EAB308";
  if (signal === "SELL")       return "#FCA5A5";
  if (signal === "STRONG_SELL")return "#EF4444";
  return "#6B7280";
}

function actionColor(action: string): { bg: string; border: string; text: string } {
  if (action === "BUY")   return { bg: "rgba(34,197,94,0.1)",   border: "rgba(34,197,94,0.3)",   text: "#22C55E" };
  if (action === "SELL")  return { bg: "rgba(239,68,68,0.1)",   border: "rgba(239,68,68,0.3)",   text: "#EF4444" };
  if (action === "WATCH") return { bg: "rgba(234,179,8,0.1)",   border: "rgba(234,179,8,0.3)",   text: "#EAB308" };
  return { bg: "transparent", border: "transparent", text: "#fff" };
}

function timeSince(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60)   return `${secs}ث`;
  if (secs < 3600) return `${Math.floor(secs / 60)}د`;
  if (secs < 86400)return `${Math.floor(secs / 3600)}س`;
  return `${Math.floor(secs / 86400)}ي`;
}

function StockRow({ stock, onPredict }: { stock: EgxStock, onPredict?: (sym: string) => void }) {
  const isPos = stock.change >= 0;
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "10px 14px", borderRadius: 10,
      background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)",
      marginBottom: 6,
    }}>
      <div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{stock.symbol}</p>
          <span style={{ fontSize: 12, fontWeight: 700, color: isPos ? "#22C55E" : "#EF4444", display: "flex", alignItems: "center", gap: 2 }}>
            {isPos ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
            {isPos ? "+" : ""}{stock.change.toFixed(2)}%
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
          {stock.rsi !== null && (
            <span style={{ fontSize: 11, color: stock.rsi < 30 ? "#22C55E" : stock.rsi > 70 ? "#EF4444" : "var(--text-muted)" }}>
              RSI {stock.rsi.toFixed(0)}
            </span>
          )}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {onPredict && (
          <button
            onClick={() => onPredict(stock.symbol)}
            style={{
              background: "rgba(99,102,241,0.15)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.3)",
              padding: "4px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", gap: 4, cursor: "pointer"
            }}
          >
            <BrainCircuit size={12} /> AI Forecast
          </button>
        )}
        <span style={{
          fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 5, minWidth: 50, textAlign: "center",
          background: `${signalColor(stock.signal)}22`,
          border: `1px solid ${signalColor(stock.signal)}44`,
          color: signalColor(stock.signal), whiteSpace: "nowrap",
        }}>
          {stock.signal.replace("_", " ")}
        </span>
      </div>
    </div>
  );
}

function PortfolioCard({ pos, onPredict }: { pos: EgxPosition; onPredict?: (sym: string) => void }) {
  const ageH = (Date.now() - new Date(pos.alertedAt).getTime()) / 3600000;
  const sc = signalColor(pos.lastSignal);
  return (
    <div style={{
      padding: "14px 16px", borderRadius: 12,
      background: "rgba(34,197,94,0.04)",
      border: "1px solid rgba(34,197,94,0.15)", marginBottom: 8,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{pos.symbol}</p>
          <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{pos.name}</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {onPredict && (
            <button
              onClick={() => onPredict(pos.symbol)}
              style={{
                background: "rgba(99,102,241,0.15)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.3)",
                padding: "4px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", gap: 4, cursor: "pointer",
                transition: "all 0.2s",
              }}
            >
              <BrainCircuit size={12} /> AI Forecast
            </button>
          )}
          <span style={{
            fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 5,
            background: `${sc}22`, border: `1px solid ${sc}44`, color: sc,
          }}>
            {pos.lastSignal.replace("_", " ")}
          </span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 16, marginTop: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          📥 تنبيه عند: <b style={{ color: "var(--text-primary)" }}>{pos.alertPrice.toFixed(2)} جنيه</b>
        </span>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          ⏱️ منذ: <b style={{ color: "var(--text-primary)" }}>{ageH < 1 ? `${Math.round(ageH * 60)}د` : `${ageH.toFixed(0)}س`}</b>
        </span>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          📈 نقاط: <b style={{ color: "var(--text-primary)" }}>{pos.lastScore}/100</b>
        </span>
      </div>
    </div>
  );
}

function AlertRow({ alert }: { alert: EgxAlert }) {
  const c = actionColor(alert.action);
  const icon = alert.action === "BUY" ? "🟢" : alert.action === "SELL" ? "🔴" : "👀";
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "1.5rem 6rem 1fr auto auto",
      gap: 10, alignItems: "center",
      padding: "10px 14px", borderRadius: 10,
      background: c.bg, border: `1px solid ${c.border}`, marginBottom: 6,
    }}>
      <span style={{ fontSize: 14 }}>{icon}</span>
      <div>
        <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{alert.symbol}</p>
        <p style={{ fontSize: 10, color: "var(--text-muted)" }}>{alert.price.toFixed(2)} جنيه</p>
      </div>
      <p style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4 }}>{alert.reason}</p>
      <span style={{ fontSize: 11, fontWeight: 600, color: c.text }}>{alert.action}</span>
      <span style={{ fontSize: 10, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{timeSince(alert.timestamp)}</span>
    </div>
  );
}

function MoodBar({ bullish, neutral, bearish }: { bullish: number; neutral: number; bearish: number }) {
  const total = bullish + neutral + bearish || 1;
  return (
    <>
      <div style={{ display: "flex", height: 7, borderRadius: 4, overflow: "hidden", gap: 1, marginTop: 10 }}>
        <div style={{ flex: bullish / total, background: "#22C55E" }} />
        <div style={{ flex: neutral / total, background: "#EAB308" }} />
        <div style={{ flex: bearish / total, background: "#EF4444" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5 }}>
        <span style={{ fontSize: 11, color: "#22C55E" }}>🟢 {bullish} صاعد</span>
        <span style={{ fontSize: 11, color: "#EAB308" }}>🟡 {neutral} محايد</span>
        <span style={{ fontSize: 11, color: "#EF4444" }}>🔴 {bearish} هابط</span>
      </div>
    </>
  );
}

export default function EgxPage() {
  const [data, setData]             = useState<EgxBriefResponse | null>(null);
  const [loading, setLoading]       = useState(true);
  const [tab, setTab]               = useState<"market" | "portfolio" | "history" | "kronos" | "recs" | "paper">("market");
  const [strongBuyOnly, setStrongBuyOnly] = useState(false);
  
  // AI Upload State
  const [analyzingImage, setAnalyzingImage] = useState(false);
  const [aiError, setAiError] = useState("");
  const [recommendations, setRecommendations] = useState<any[] | null>(null);

  // Kronos UI State
  const [kronosSymbol, setKronosSymbol] = useState<string | null>(null);
  const [kronosLoading, setKronosLoading] = useState(false);
  const [kronosData, setKronosData] = useState<any | null>(null);

  // Kronos History Tab State
  const [kronosHistory, setKronosHistory] = useState<any | null>(null);
  const [kronosHistoryLoading, setKronosHistoryLoading] = useState(false);

  const fetchKronosHistory = useCallback(async () => {
    setKronosHistoryLoading(true);
    try {
      const res = await fetch("/api/egx/kronos-history");
      if (res.ok) setKronosHistory(await res.json());
    } catch { /* silent */ }
    finally { setKronosHistoryLoading(false); }
  }, []);

  useEffect(() => {
    if (tab === "kronos" && !kronosHistory) fetchKronosHistory();
  }, [tab, kronosHistory, fetchKronosHistory]);

  // Kronos Recommendations Tab State
  const [kronosRecs, setKronosRecs] = useState<any | null>(null);
  const [kronosRecsLoading, setKronosRecsLoading] = useState(false);

  const fetchKronosRecs = useCallback(async () => {
    setKronosRecsLoading(true);
    try {
      const res = await fetch("/api/egx/kronos-recs");
      if (res.ok) setKronosRecs(await res.json());
    } catch { /* silent */ }
    finally { setKronosRecsLoading(false); }
  }, []);

  useEffect(() => {
    if (tab === "recs" && !kronosRecs) fetchKronosRecs();
  }, [tab, kronosRecs, fetchKronosRecs]);

  // Paper Trading Tab State
  const [paperData, setPaperData] = useState<any | null>(null);
  const [paperLoading, setPaperLoading] = useState(false);

  const fetchPaperTrades = useCallback(async () => {
    setPaperLoading(true);
    try {
      const res = await fetch("/api/egx/paper-trades");
      if (res.ok) setPaperData(await res.json());
    } catch { /* silent */ }
    finally { setPaperLoading(false); }
  }, []);

  useEffect(() => {
    if (tab === "paper" && !paperData) fetchPaperTrades();
  }, [tab, paperData, fetchPaperTrades]);

  const predictKronos = async (symbol: string) => {
    setKronosSymbol(symbol);
    setKronosLoading(true);
    setKronosData(null);
    try {
      const res = await fetch("/api/egx/forecast", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol })
      });
      if (!res.ok) throw new Error(await res.text());
      const resData = await res.json();
      if (resData.forecast) {
        setKronosData(resData);
      } else {
        throw new Error(resData.error || "No forecast returned");
      }
    } catch (e: any) {
      alert("Kronos Error: " + (e.message || e));
      setKronosSymbol(null);
    }
    setKronosLoading(false);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    setAnalyzingImage(true);
    setAiError("");
    setRecommendations(null);

    try {
      const base64s = await Promise.all(files.map(file => {
        return new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      }));

      // 1. Analyze with Gemini
      const geminiRes = await fetch("/api/egx/analyze-screenshot", {
        method: "POST", 
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imagesBase64: base64s }),
      });
      if (!geminiRes.ok) throw new Error((await geminiRes.json())?.error || "Gemini API error");
      const { portfolio } = await geminiRes.json();

      // Merge with existing thndrPortfolio so multiple uploads update the same profile
      let mergedPortfolio = data?.thndrPortfolio ? [...data.thndrPortfolio] : [];
      portfolio.forEach((newItem: any) => {
        const existingIdx = mergedPortfolio.findIndex(p => p.symbol === newItem.symbol);
        if (existingIdx !== -1) {
           mergedPortfolio[existingIdx] = newItem;
        } else {
           mergedPortfolio.push(newItem);
        }
      });

      // 2. Feed to Recommendations logic
      const recRes = await fetch("/api/egx/recommend", {
        method: "POST", 
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ portfolio: mergedPortfolio, save: true })
      });
      if (!recRes.ok) throw new Error((await recRes.json())?.error || "Recommendation API error");
      const recData = await recRes.json();

      setRecommendations(recData.recommendations);
      setData(prev => prev ? { ...prev, thndrPortfolio: mergedPortfolio } : prev);
    } catch (err: any) {
      setAiError(err.message || String(err));
    } finally {
      setAnalyzingImage(false);
    }
  };

  useEffect(() => {
    if (tab === "portfolio" && data?.thndrPortfolio && data.thndrPortfolio.length > 0 && !recommendations && !analyzingImage) {
      setAnalyzingImage(true);
      fetch("/api/egx/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ portfolio: data.thndrPortfolio })
      }).then(res => res.json()).then(res => {
        if (res.recommendations) setRecommendations(res.recommendations);
      }).catch(() => {}).finally(() => setAnalyzingImage(false));
    }
  }, [tab, data?.thndrPortfolio, recommendations, analyzingImage]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/egx/brief");
      if (res.ok) setData(await res.json());
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const ov = data?.overview;
  const mood = ov
    ? ov.bullishCount > ov.bearishCount * 1.5 ? { label: "سوق متفائل", color: "#22C55E" }
    : ov.bearishCount > ov.bullishCount * 1.5 ? { label: "سوق متشائم", color: "#EF4444" }
    : { label: "سوق محايد", color: "#EAB308" }
    : null;

  const TAB_STYLE = (active: boolean) => ({
    padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600,
    cursor: "pointer", border: "none", transition: "all 0.2s",
    background: active ? "rgba(234,179,8,0.15)" : "transparent",
    color: active ? "#EAB308" : "var(--text-muted)",
    outline: active ? "1px solid rgba(234,179,8,0.3)" : "none",
  });

  return (
    <div style={{ minHeight: "100vh", padding: "24px", maxWidth: "1280px", margin: "0 auto" }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link href="/" style={{ textDecoration: "none" }}>
            <button className="btn-ghost" style={{ padding: "8px 12px", display: "flex", alignItems: "center", gap: 5 }}>
              <ChevronLeft size={14} /><span style={{ fontSize: 12 }}>الذهب</span>
            </button>
          </Link>
          <div style={{
            width: 42, height: 42, borderRadius: 12,
            background: "linear-gradient(135deg, #1E3A5F 0%, #2563EB 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 0 20px rgba(37,99,235,0.4)",
          }}>
            <BarChart3 size={20} color="#fff" />
          </div>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>
              البورصة المصرية
            </h1>
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 1 }}>
              EGX · تنبيهات تلقائية كل 30 دقيقة أثناء الجلسة
            </p>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {data?.lastScan && (
            <span style={{ fontSize: 11, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
              <Clock size={10} />آخر مسح: {timeSince(data.lastScan)}
            </span>
          )}
          <button className="btn-ghost" onClick={fetchData} style={{ padding: "8px 12px", display: "flex", alignItems: "center", gap: 6 }}>
            <RefreshCw size={14} /><span style={{ fontSize: 13 }}>تحديث</span>
          </button>
        </div>
      </div>

      {/* ── Market Closed Banner ── */}
      {data?.marketStatus && !data.marketStatus.open && (
        <div style={{
          marginBottom: 20, padding: "12px 20px", borderRadius: 12, direction: "rtl",
          background: "rgba(234,179,8,0.07)", border: "1px solid rgba(234,179,8,0.25)",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <AlertTriangle size={15} color="#EAB308" style={{ flexShrink: 0 }} />
          <p style={{ fontSize: 13, color: "#EAB308", fontWeight: 500 }}>
            <b>⚠️ {data.marketStatus.reason}</b>
            &nbsp;— البيانات المعروضة من آخر جلسة تداول وقد لا تعكس الوضع الفوري.
          </p>
        </div>
      )}
      {/* ── Market Mood ── */}
      <div className="glass-card" style={{ padding: "20px 24px", marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <p style={{ fontSize: 12, color: "var(--text-muted)" }}>إجمالي الأسهم المحللة</p>
            {loading ? <div className="skeleton" style={{ width: 80, height: 28, marginTop: 4 }} /> : (
              <p style={{ fontSize: 28, fontWeight: 800, color: "var(--text-primary)" }}>{ov?.totalScanned ?? "—"}</p>
            )}
          </div>
          {mood && (
            <span style={{
              fontSize: 14, fontWeight: 700, color: mood.color,
              background: `${mood.color}22`, padding: "6px 16px",
              borderRadius: 20, border: `1px solid ${mood.color}44`,
            }}>
              {mood.label}
            </span>
          )}
          <div style={{ display: "flex", gap: 20 }}>
            {[
              { label: "في المحفظة", value: data?.portfolio?.length ?? 0, color: "#22C55E" },
              { label: "تنبيهات", value: data?.alerts?.length ?? 0, color: "#EAB308" },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ textAlign: "right" }}>
                <p style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</p>
                <p style={{ fontSize: 22, fontWeight: 700, color }}>{value}</p>
              </div>
            ))}
          </div>
        </div>
        {ov && !loading && (
          <MoodBar bullish={ov.bullishCount} neutral={ov.neutralCount} bearish={ov.bearishCount} />
        )}
      </div>

      {/* ── Tab switcher ── */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, background: "rgba(255,255,255,0.03)", padding: 4, borderRadius: 10, width: "fit-content" }}>
        <button style={TAB_STYLE(tab === "market")}    onClick={() => setTab("market")}>
          <Activity size={12} style={{ display: "inline", marginRight: 5 }} />السوق
        </button>
        <button style={TAB_STYLE(tab === "portfolio")} onClick={() => setTab("portfolio")}>
          <Briefcase size={12} style={{ display: "inline", marginRight: 5 }} />
          المحفظة {data?.portfolio?.length ? `(${data.portfolio.length})` : ""}
        </button>
        <button style={TAB_STYLE(tab === "history")}   onClick={() => setTab("history")}>
          <Bell size={12} style={{ display: "inline", marginRight: 5 }} />
          السجل {data?.alerts?.length ? `(${data.alerts.length})` : ""}
        </button>
        <button style={TAB_STYLE(tab === "kronos")} onClick={() => setTab("kronos")}>
          <Brain size={12} style={{ display: "inline", marginRight: 5 }} />
          Kronos AI
        </button>
        <button style={TAB_STYLE(tab === "recs")} onClick={() => setTab("recs")}>
          <Sparkles size={12} style={{ display: "inline", marginRight: 5 }} />
          توصيات
        </button>
        <button style={{...TAB_STYLE(tab === "paper"), background: tab === "paper" ? "rgba(34,197,94,0.15)" : "transparent", color: tab === "paper" ? "#22C55E" : "var(--text-muted)", outline: tab === "paper" ? "1px solid rgba(34,197,94,0.3)" : "none"}} onClick={() => setTab("paper")}>
          <DollarSign size={12} style={{ display: "inline", marginRight: 5 }} />
          Paper P&L
        </button>
      </div>

      {/* ── MARKET TAB ── */}
      {tab === "market" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div className="glass-card" style={{ padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <TrendingUp size={15} color="#22C55E" />
              <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>أقوى إشارات الشراء</h2>
            </div>
            {loading ? [...Array(4)].map((_, i) => <div key={i} className="skeleton" style={{ height: 52, borderRadius: 10, marginBottom: 6 }} />) :
              ov?.topBuys.length ? ov.topBuys.map(s => <StockRow key={s.symbol} stock={s} onPredict={predictKronos} />) :
              <p style={{ color: "var(--text-muted)", fontSize: 13 }}>لا توجد إشارات شراء حالياً</p>}
          </div>

          <div className="glass-card" style={{ padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <Activity size={15} color="#EAB308" />
              <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>مراقبة — RSI منخفض</h2>
            </div>
            <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 10 }}>RSI {"<"} 35 · ارتداد محتمل</p>
            {loading ? [...Array(3)].map((_, i) => <div key={i} className="skeleton" style={{ height: 52, borderRadius: 10, marginBottom: 6 }} />) :
              ov?.watchlist.length ? ov.watchlist.map(s => <StockRow key={s.symbol} stock={s} onPredict={predictKronos} />) :
              <p style={{ color: "var(--text-muted)", fontSize: 13 }}>لا توجد أسهم ذات RSI منخفض</p>}
          </div>

          <div className="glass-card" style={{ padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <ArrowUpRight size={15} color="#22C55E" />
              <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>الأكثر ارتفاعاً</h2>
            </div>
            {loading ? [...Array(3)].map((_, i) => <div key={i} className="skeleton" style={{ height: 52, borderRadius: 10, marginBottom: 6 }} />) :
              ov?.topGainers.length ? ov.topGainers.map(s => <StockRow key={s.symbol} stock={s} onPredict={predictKronos} />) :
              <p style={{ color: "var(--text-muted)", fontSize: 13 }}>لا توجد بيانات</p>}
          </div>

          <div className="glass-card" style={{ padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <ArrowDownRight size={15} color="#EF4444" />
              <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>الأكثر انخفاضاً</h2>
            </div>
            {loading ? [...Array(3)].map((_, i) => <div key={i} className="skeleton" style={{ height: 52, borderRadius: 10, marginBottom: 6 }} />) :
              ov?.topLosers.length ? ov.topLosers.map(s => <StockRow key={s.symbol} stock={s} onPredict={predictKronos} />) :
              <p style={{ color: "var(--text-muted)", fontSize: 13 }}>لا توجد بيانات</p>}
          </div>
        </div>
      )}

      {/* ── PORTFOLIO TAB ── */}
      {tab === "portfolio" && (() => {
        const strongBuyCount = data?.portfolio?.filter(p => p.lastSignal === "STRONG_BUY").length ?? 0;
        const visiblePortfolio = strongBuyOnly
          ? (data?.portfolio ?? []).filter(p => p.lastSignal === "STRONG_BUY")
          : (data?.portfolio ?? []);
        return (
          <>
            {/* ── AI Screenshot Analyzer Card ── */}
            <div className="glass-card" style={{ padding: 24, marginBottom: 16, direction: "rtl", textAlign: "right" }}>
               <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                 <Zap size={16} color="#A855F7" />
                 <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>تحليل صورة المحفظة (Thndr) بالذكاء الاصطناعي</h2>
               </div>
               <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16, lineHeight: 1.5 }}>
                 قم برفع لقطة شاشة (Screenshot) لمحفظتك من تطبيق ثاندر أو أي تطبيق تداول آخر. سيقوم النظام باستخراج الأسهم ومتوسط أسعار الشراء، ويمنحك توصيات فورية (شراء، بيع، احتفاظ، أو تعديل) بناءً على حركة السوق الحالية!
               </p>

               <label style={{
                 display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                 padding: "16px", borderRadius: 12, border: "1px dashed rgba(168,85,247,0.4)",
                 background: "rgba(168,85,247,0.05)", color: "#A855F7", cursor: "pointer",
                 transition: "all 0.2s", fontWeight: 600, fontSize: 13
               }}>
                 <input type="file" multiple accept="image/*" style={{ display: "none" }} onChange={handleImageUpload} disabled={analyzingImage} />
                 {analyzingImage ? (
                    <><span className="pulse-dot" style={{ background: "#A855F7" }} /> جاري تحليل الصورة واستخراج التوصيات...</>
                 ) : (
                    "📷 رفع لقطة شاشة وتحليل المؤشرات"
                 )}
               </label>
               {aiError && <p style={{ fontSize: 11, color: "#EF4444", marginTop: 10 }}>خطأ: {aiError}</p>}

               {/* AI Results */}
               {recommendations && (
                 <div style={{ marginTop: 24 }}>
                   <div style={{ height: 1, background: "rgba(255,255,255,0.05)", margin: "0 -24px 20px -24px" }} />
                   <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 16, color: "#A855F7" }}>✨ توصيات ذكية لمحفظتك:</h3>
                   <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                     {recommendations.map((r, i) => {
                       const c = r.recommendationType === 'BUY_MORE' || r.recommendationType === 'AVERAGE_DOWN' ? '#22C55E' 
                               : r.recommendationType === 'TAKE_PROFIT' ? '#3B82F6' 
                               : r.recommendationType === 'CUT_LOSS' ? '#EF4444' 
                               : '#EAB308';
                       return (
                         <div key={i} style={{ 
                           padding: 16, background: "rgba(0,0,0,0.2)", 
                           border: `1px solid ${c}44`, borderRadius: 12 
                         }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
                              <div>
                                <span style={{ fontWeight: 800, fontSize: 15, color: "var(--text-primary)" }}>{r.symbol}</span>
                                {r.shares > 0 && <span style={{ fontSize: 11, color: "var(--text-muted)", marginRight: 6 }}>({r.shares} سهم)</span>}
                                {r.error && <p style={{ fontSize: 11, color: "#EF4444", marginTop: 4 }}>{r.error}</p>}
                                {!r.error && (
                                  <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6, display: "flex", gap: 12, flexWrap: "wrap" }}>
                                    <span>متوسط الشراء: <b style={{ color: "var(--text-primary)" }}>{r.buyPrice}</b></span>
                                    <span>السعر الحالي: <b style={{ color: "var(--text-primary)" }}>{r.currentPrice}</b></span>
                                    <span>العائد: <b style={{ color: r.pnlPct >= 0 ? '#22C55E' : '#EF4444' }} dir="ltr">{r.pnlPct > 0 ? "+" : ""}{r.pnlPct?.toFixed(2)}%</b></span>
                                  </p>
                                )}
                              </div>
                              <span style={{ 
                                fontSize: 10, fontWeight: 800, padding: "4px 8px", borderRadius: 6, 
                                background: `${c}15`, color: c, border: `1px solid ${c}30`
                              }}>
                                {r.recommendationType.replace("_", " ")}
                              </span>
                            </div>
                            {!r.error && (
                              <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 12, lineHeight: 1.5, padding: "10px", background: "rgba(255,255,255,0.03)", borderRadius: 8 }}>
                                💡 {r.recommendationText}
                              </p>
                            )}
                         </div>
                       );
                     })}
                   </div>
                 </div>
               )}
            </div>

            <div className="glass-card" style={{ padding: 24 }}>
            {/* Header row */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
              <Briefcase size={15} color="#22C55E" />
              <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>المحفظة التلقائية</h2>
              <span style={{ fontSize: 11, color: "var(--text-muted)", marginRight: "auto" }}>
                أسهم أرسلنا لها إشارة شراء ولم تصل بعد لإشارة البيع
              </span>

              {/* ── STRONG BUY filter chip ── */}
              <button
                onClick={() => setStrongBuyOnly(v => !v)}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "5px 12px", borderRadius: 20, fontSize: 12, fontWeight: 700,
                  border: strongBuyOnly ? "1px solid #22C55E" : "1px solid rgba(34,197,94,0.25)",
                  background: strongBuyOnly ? "rgba(34,197,94,0.15)" : "rgba(34,197,94,0.05)",
                  color: strongBuyOnly ? "#22C55E" : "rgba(34,197,94,0.6)",
                  cursor: "pointer", transition: "all 0.2s",
                  boxShadow: strongBuyOnly ? "0 0 10px rgba(34,197,94,0.2)" : "none",
                }}
              >
                <span style={{ fontSize: 10 }}>⚡</span>
                STRONG BUY فقط
                {strongBuyCount > 0 && (
                  <span style={{
                    fontSize: 10, fontWeight: 800,
                    background: strongBuyOnly ? "#22C55E" : "rgba(34,197,94,0.3)",
                    color: strongBuyOnly ? "#000" : "#22C55E",
                    borderRadius: 99, padding: "1px 6px", minWidth: 18, textAlign: "center",
                  }}>
                    {strongBuyCount}
                  </span>
                )}
              </button>
            </div>

            {/* Empty / filtered-empty states */}
            {loading ? (
              [...Array(3)].map((_, i) => <div key={i} className="skeleton" style={{ height: 75, borderRadius: 12, marginBottom: 8 }} />)
            ) : visiblePortfolio.length ? (
              visiblePortfolio.map(p => <PortfolioCard key={p.symbol} pos={p} onPredict={predictKronos} />)
            ) : strongBuyOnly ? (
              <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--text-muted)" }}>
                <span style={{ fontSize: 36, display: "block", marginBottom: 12 }}>⚡</span>
                <p style={{ fontSize: 14, color: "#22C55E" }}>لا توجد أسهم بإشارة STRONG BUY حالياً</p>
                <p style={{ fontSize: 12, marginTop: 6 }}>جرّب إيقاف الفلتر لعرض كل المحفظة</p>
              </div>
            ) : (
              <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--text-muted)" }}>
                <Briefcase size={32} style={{ margin: "0 auto 12px", opacity: 0.3 }} />
                <p style={{ fontSize: 14 }}>المحفظة فارغة حالياً</p>
                <p style={{ fontSize: 12, marginTop: 6 }}>ستظهر الأسهم هنا عند إرسال إشارة شراء</p>
              </div>
            )}
          </div>
          </>
        );
      })()}

      {/* ── HISTORY TAB ── */}
      {tab === "history" && (
        <div className="glass-card" style={{ padding: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <Bell size={15} color="#EAB308" />
            <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>سجل التنبيهات</h2>
            <span style={{ fontSize: 11, color: "var(--text-muted)", marginRight: "auto" }}>
              آخر {data?.alerts?.length ?? 0} تنبيه
            </span>
          </div>
          {loading ? [...Array(5)].map((_, i) => <div key={i} className="skeleton" style={{ height: 52, borderRadius: 10, marginBottom: 6 }} />) :
           data?.alerts?.length ? data.alerts.map(a => <AlertRow key={a.id} alert={a} />) : (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--text-muted)" }}>
              <Bell size={32} style={{ margin: "0 auto 12px", opacity: 0.3 }} />
              <p style={{ fontSize: 14 }}>لا توجد تنبيهات بعد</p>
              <p style={{ fontSize: 12, marginTop: 6 }}>ستصلك التنبيهات تلقائياً أثناء جلسة التداول</p>
            </div>
          )}
        </div>
      )}

      {/* ── KRONOS HISTORY TAB ── */}
      {tab === "kronos" && (
        <div>
          {/* Stats Overview Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 20 }}>
            {/* Accuracy Card */}
            <div className="glass-card" style={{
              padding: "20px", textAlign: "center",
              background: "linear-gradient(135deg, rgba(99,102,241,0.08) 0%, rgba(139,92,246,0.05) 100%)",
              border: "1px solid rgba(99,102,241,0.2)",
            }}>
              <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>دقة التوقعات</p>
              {kronosHistoryLoading ? (
                <div className="skeleton" style={{ width: 60, height: 36, margin: "0 auto" }} />
              ) : (() => {
                const acc = kronosHistory?.stats?.accuracy;
                const color = acc === null ? "#818cf8" : acc >= 55 ? "#22C55E" : acc >= 40 ? "#EAB308" : "#EF4444";
                return (
                  <p style={{ fontSize: 32, fontWeight: 800, color }}>
                    {acc !== null && acc !== undefined ? `${acc}%` : "—"}
                  </p>
                );
              })()}
              <p style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
                Direction Accuracy
              </p>
              {(kronosHistory?.stats?.skippedHoliday ?? 0) > 0 && (
                <p style={{ fontSize: 9, color: "rgba(234,179,8,0.7)", marginTop: 3 }}>
                  ⚠️ {kronosHistory.stats.skippedHoliday} توقع مستثنى (عطلة)
                </p>
              )}
            </div>

            {/* Total Predictions */}
            <div className="glass-card" style={{ padding: "20px", textAlign: "center" }}>
              <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>إجمالي التنبؤات</p>
              {kronosHistoryLoading ? (
                <div className="skeleton" style={{ width: 40, height: 36, margin: "0 auto" }} />
              ) : (
                <p style={{ fontSize: 32, fontWeight: 800, color: "var(--text-primary)" }}>
                  {kronosHistory?.stats?.total ?? 0}
                </p>
              )}
              <p style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>All Time</p>
            </div>

            {/* Correct Predictions */}
            <div className="glass-card" style={{ padding: "20px", textAlign: "center" }}>
              <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>اتجاه صحيح</p>
              {kronosHistoryLoading ? (
                <div className="skeleton" style={{ width: 40, height: 36, margin: "0 auto" }} />
              ) : (
                <p style={{ fontSize: 32, fontWeight: 800, color: "#22C55E" }}>
                  {kronosHistory?.stats?.correct ?? 0}
                </p>
              )}
              <p style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
                من {kronosHistory?.stats?.checked ?? 0} تم التحقق منها
              </p>
            </div>

            {/* Wrong Predictions */}
            <div className="glass-card" style={{ padding: "20px", textAlign: "center" }}>
              <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>اتجاه خاطئ</p>
              {kronosHistoryLoading ? (
                <div className="skeleton" style={{ width: 40, height: 36, margin: "0 auto" }} />
              ) : (
                <p style={{ fontSize: 32, fontWeight: 800, color: "#EF4444" }}>
                  {(kronosHistory?.stats?.checked ?? 0) - (kronosHistory?.stats?.correct ?? 0)}
                </p>
              )}
              <p style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>Incorrect Direction</p>
            </div>

            {/* Holiday excluded card — only shows when relevant */}
            {(kronosHistory?.stats?.skippedHoliday ?? 0) > 0 && (
              <div className="glass-card" style={{
                padding: "20px", textAlign: "center",
                background: "rgba(234,179,8,0.04)",
                border: "1px solid rgba(234,179,8,0.2)",
              }}>
                <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>مستثنى عطلة</p>
                {kronosHistoryLoading ? (
                  <div className="skeleton" style={{ width: 40, height: 36, margin: "0 auto" }} />
                ) : (
                  <p style={{ fontSize: 32, fontWeight: 800, color: "#EAB308" }}>
                    {kronosHistory?.stats?.skippedHoliday ?? 0}
                  </p>
                )}
                <p style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>توقع وقت الإغلاق</p>
              </div>
            )}
          </div>

          {/* Prediction History Cards */}
          <div className="glass-card" style={{ padding: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 10,
                background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 0 14px rgba(99,102,241,0.4)",
              }}>
                <Brain size={16} color="#fff" />
              </div>
              <div>
                <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>سجل توقعات Kronos-AI</h2>
                <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>مقارنة التوقعات بالأسعار الفعلية</p>
              </div>
              <button
                className="btn-ghost"
                onClick={fetchKronosHistory}
                style={{ marginLeft: "auto", padding: "6px 12px", display: "flex", alignItems: "center", gap: 5, fontSize: 12 }}
              >
                <RefreshCw size={12} /> تحديث
              </button>
            </div>

            {kronosHistoryLoading ? (
              [...Array(4)].map((_, i) => (
                <div key={i} className="skeleton" style={{ height: 110, borderRadius: 14, marginBottom: 10 }} />
              ))
            ) : !kronosHistory?.predictions?.length ? (
              <div style={{ textAlign: "center", padding: "50px 20px", color: "var(--text-muted)" }}>
                <Brain size={40} style={{ margin: "0 auto 16px", opacity: 0.2 }} />
                <p style={{ fontSize: 15, fontWeight: 600 }}>لا توجد توقعات بعد</p>
                <p style={{ fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>
                  استخدم زر <span style={{ color: "#818cf8", fontWeight: 600 }}>AI Forecast</span> على أي سهم في تبويب السوق أو المحفظة<br />
                  لإنشاء أول توقع وتتبع دقته مع الوقت
                </p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {kronosHistory.predictions.map((pred: any, i: number) => {
                  const daysSince = Math.floor((Date.now() - new Date(pred.predictedAt).getTime()) / (1000 * 60 * 60 * 24));
                  const hasActual = pred.livePrice !== null;
                  const livePct = pred.liveChangePct;
                  const predictedDir = pred.predictedChangePercent >= 0;
                  
                  let actualDir: boolean | null = null;
                  let dirMatch: boolean | null = null;
                  
                  if (livePct !== null) {
                    // If it's less than 1 day old and the price hasn't moved at all (0.00%), don't judge it yet!
                    if (daysSince === 0 && Math.abs(livePct) < 0.01) {
                      dirMatch = null;
                    } else {
                      actualDir = livePct >= 0;
                      dirMatch = predictedDir === actualDir;
                    }
                  }

                  const borderColor = dirMatch === true
                    ? "rgba(34,197,94,0.25)"
                    : dirMatch === false
                    ? "rgba(239,68,68,0.25)"
                    : "rgba(99,102,241,0.2)";

                  const bgColor = dirMatch === true
                    ? "rgba(34,197,94,0.04)"
                    : dirMatch === false
                    ? "rgba(239,68,68,0.04)"
                    : "rgba(99,102,241,0.04)";

                  return (
                    <div key={pred.id || i} style={{
                      padding: "16px 20px", borderRadius: 14,
                      background: bgColor, border: `1px solid ${borderColor}`,
                      transition: "all 0.2s",
                    }}>
                      {/* Top Row: Symbol + Direction Badge */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <BrainCircuit size={16} color="#818cf8" />
                          <div>
                            <span style={{ fontSize: 16, fontWeight: 800, color: "var(--text-primary)" }}>{pred.symbol}</span>
                            <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 8 }}>
                              منذ {daysSince === 0 ? "اليوم" : `${daysSince} يوم`}
                            </span>
                          </div>
                        </div>
                        {dirMatch !== null ? (
                          <span style={{
                            display: "flex", alignItems: "center", gap: 4,
                            fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20,
                            background: dirMatch ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
                            color: dirMatch ? "#22C55E" : "#EF4444",
                            border: `1px solid ${dirMatch ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
                          }}>
                            {dirMatch ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                            {dirMatch ? "اتجاه صحيح ✓" : "اتجاه خاطئ ✗"}
                          </span>
                        ) : (
                          <span style={{
                            fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 20,
                            background: "rgba(99,102,241,0.1)", color: "#818cf8",
                            border: "1px solid rgba(99,102,241,0.2)",
                          }}>
                            ⏳ قيد المتابعة
                          </span>
                        )}
                      </div>

                      {/* Price Comparison Grid */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                        {/* Price at Prediction */}
                        <div style={{ padding: "10px 12px", background: "rgba(255,255,255,0.03)", borderRadius: 10 }}>
                          <p style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>السعر عند التوقع</p>
                          <p style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>
                            {pred.priceAtPrediction.toFixed(2)}
                            <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: 3 }}>EGP</span>
                          </p>
                        </div>

                        {/* Kronos Predicted */}
                        <div style={{ padding: "10px 12px", background: "rgba(99,102,241,0.06)", borderRadius: 10, border: "1px solid rgba(99,102,241,0.1)" }}>
                          <p style={{ fontSize: 10, color: "#818cf8", marginBottom: 4, display: "flex", alignItems: "center", gap: 3 }}>
                            <Target size={9} /> توقع Kronos
                          </p>
                          <p style={{ fontSize: 15, fontWeight: 700, color: pred.predictedChangePercent >= 0 ? "#22C55E" : "#EF4444" }}>
                            {pred.predictedChangePercent >= 0 ? "+" : ""}{pred.predictedChangePercent.toFixed(2)}%
                          </p>
                          <p style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                            هدف: {pred.predictedEndPrice.toFixed(2)} EGP
                          </p>
                        </div>

                        {/* Actual / Live */}
                        <div style={{ padding: "10px 12px", background: hasActual ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.02)", borderRadius: 10 }}>
                          <p style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>
                            {hasActual ? "السعر الحالي" : "—"}
                          </p>
                          {hasActual ? (
                            <>
                              <p style={{ fontSize: 15, fontWeight: 700, color: livePct >= 0 ? "#22C55E" : "#EF4444" }}>
                                {livePct >= 0 ? "+" : ""}{livePct.toFixed(2)}%
                              </p>
                              <p style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                                {pred.livePrice.toFixed(2)} EGP
                              </p>
                            </>
                          ) : (
                            <p style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 600 }}>بانتظار البيانات</p>
                          )}
                        </div>
                      </div>

                      {/* Footer: date + prediction range */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                        <span style={{ fontSize: 10, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
                          <Clock size={9} />
                          {new Date(pred.predictedAt).toLocaleDateString("ar-EG", { day: "numeric", month: "short", year: "numeric" })}
                          {" · "}
                          {new Date(pred.predictedAt).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                        <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                          نافذة التوقع: {pred.predictionDays} يوم · أعلى: {pred.predictedHigh.toFixed(2)} · أدنى: {pred.predictedLow.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── KRONOS RECOMMENDATIONS TAB ── */}
      {tab === "recs" && (
        <div>
          {/* Header banner */}
          <div style={{
            marginBottom: 20, padding: "20px 24px", borderRadius: 16,
            background: "linear-gradient(135deg, rgba(99,102,241,0.12) 0%, rgba(139,92,246,0.08) 50%, rgba(236,72,153,0.05) 100%)",
            border: "1px solid rgba(99,102,241,0.25)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            boxShadow: "0 0 40px rgba(99,102,241,0.08) inset",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{
                width: 44, height: 44, borderRadius: 14,
                background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 0 20px rgba(99,102,241,0.5)",
                flexShrink: 0,
              }}>
                <Sparkles size={22} color="#fff" />
              </div>
              <div>
                <h2 style={{ fontSize: 17, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>
                  توصيات Kronos-AI للشراء
                </h2>
                <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
                  مرتبة حسب نقاط الاقتناع · بناءً على أحدث توقعات Kronos لكل سهم
                </p>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {kronosRecs?.stats && (
                <div style={{ display: "flex", gap: 8 }}>
                  {kronosRecs.stats.strongBuyCount > 0 && (
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20, background: "rgba(34,197,94,0.15)", color: "#22C55E", border: "1px solid rgba(34,197,94,0.3)" }}>
                      ⚡ {kronosRecs.stats.strongBuyCount} Strong Buy
                    </span>
                  )}
                  {kronosRecs.stats.buyCount > 0 && (
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20, background: "rgba(99,102,241,0.12)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.25)" }}>
                      {kronosRecs.stats.buyCount} Buy
                    </span>
                  )}
                </div>
              )}
              <button
                className="btn-ghost"
                onClick={fetchKronosRecs}
                style={{ padding: "6px 12px", display: "flex", alignItems: "center", gap: 5, fontSize: 12 }}
              >
                <RefreshCw size={12} /> تحديث
              </button>
            </div>
          </div>

          {/* Recommendations grid */}
          {kronosRecsLoading ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 14 }}>
              {[...Array(4)].map((_, i) => (
                <div key={i} className="skeleton" style={{ height: 200, borderRadius: 16 }} />
              ))}
            </div>
          ) : !kronosRecs?.recommendations?.length ? (
            <div className="glass-card" style={{ padding: "60px 24px", textAlign: "center" }}>
              <div style={{ width: 64, height: 64, borderRadius: 20, background: "rgba(99,102,241,0.08)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
                <Sparkles size={28} color="rgba(99,102,241,0.4)" />
              </div>
              <p style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", marginBottom: 10 }}>لا توجد توصيات بعد</p>
              <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.7, maxWidth: 400, margin: "0 auto" }}>
                استخدم زر <span style={{ color: "#818cf8", fontWeight: 700 }}>AI Forecast</span> على أي سهم في تبويب
                <span style={{ color: "#EAB308", fontWeight: 700 }}> السوق</span> أو
                <span style={{ color: "#22C55E", fontWeight: 700 }}> المحفظة</span>.<br />
                Kronos سيحلل البيانات التاريخية ويتوقع مسار السعر لغداً (توقع يومي)،
                وتظهر التوصيات هنا تلقائياً.
              </p>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 14 }}>
              {kronosRecs.recommendations.map((rec: any, idx: number) => {
                const isStrong = rec.strength === "STRONG_BUY";
                const isBuy   = rec.strength === "BUY";
                const isWatch = rec.strength === "WATCH";

                const strengthColor = isStrong ? "#22C55E" : isBuy ? "#818cf8" : "#EAB308";
                const strengthBg    = isStrong ? "rgba(34,197,94,0.1)" : isBuy ? "rgba(99,102,241,0.1)" : "rgba(234,179,8,0.1)";
                const strengthBorder= isStrong ? "rgba(34,197,94,0.3)" : isBuy ? "rgba(99,102,241,0.3)" : "rgba(234,179,8,0.3)";
                const cardBorder    = isStrong ? "rgba(34,197,94,0.2)" : isBuy ? "rgba(99,102,241,0.15)" : "rgba(255,255,255,0.06)";
                const cardGlow      = isStrong ? "0 0 30px rgba(34,197,94,0.06) inset" : isBuy ? "0 0 30px rgba(99,102,241,0.05) inset" : "none";

                const rankColor = idx === 0 ? "#F59E0B" : idx === 1 ? "#94A3B8" : idx === 2 ? "#CD7F32" : "var(--text-muted)";

                return (
                  <div key={rec.symbol} style={{
                    padding: "20px", borderRadius: 16,
                    background: "rgba(255,255,255,0.02)",
                    border: `1px solid ${cardBorder}`,
                    boxShadow: cardGlow,
                    position: "relative", overflow: "hidden",
                    transition: "all 0.2s",
                  }}>
                    {/* Rank badge */}
                    <div style={{
                      position: "absolute", top: 14, right: 14,
                      width: 28, height: 28, borderRadius: 8,
                      background: "rgba(255,255,255,0.05)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 12, fontWeight: 800, color: rankColor,
                    }}>
                      #{idx + 1}
                    </div>

                    {/* Symbol + strength */}
                    <div style={{ marginBottom: 16, paddingRight: 36 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <BrainCircuit size={15} color="#818cf8" />
                        <span style={{ fontSize: 20, fontWeight: 900, color: "var(--text-primary)", letterSpacing: "-0.01em" }}>
                          {rec.symbol}
                        </span>
                      </div>
                      <span style={{
                        fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 20,
                        background: strengthBg, color: strengthColor, border: `1px solid ${strengthBorder}`,
                        display: "inline-flex", alignItems: "center", gap: 4,
                      }}>
                        {isStrong ? "⚡" : isBuy ? "🔵" : "👀"} {rec.strength.replace("_", " ")}
                      </span>
                    </div>

                    {/* Conviction bar */}
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>نقاط الاقتناع</span>
                        <span style={{ fontSize: 13, fontWeight: 800, color: strengthColor }}>{rec.conviction}/100</span>
                      </div>
                      <div style={{ height: 6, borderRadius: 99, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                        <div style={{
                          height: "100%", borderRadius: 99, width: `${rec.conviction}%`,
                          background: isStrong
                            ? "linear-gradient(90deg, #16a34a, #22C55E)"
                            : isBuy
                            ? "linear-gradient(90deg, #4f46e5, #818cf8)"
                            : "linear-gradient(90deg, #a16207, #EAB308)",
                          transition: "width 0.8s ease",
                        }} />
                      </div>
                    </div>

                    {/* Price grid */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
                      <div style={{ padding: "8px 10px", background: "rgba(255,255,255,0.03)", borderRadius: 10 }}>
                        <p style={{ fontSize: 9, color: "var(--text-muted)", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.05em" }}>سعر التوقع</p>
                        <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>
                          {rec.priceAtPrediction.toFixed(2)}
                          <span style={{ fontSize: 9, color: "var(--text-muted)", marginLeft: 2 }}>EGP</span>
                        </p>
                      </div>
                      <div style={{ padding: "8px 10px", background: "rgba(99,102,241,0.06)", borderRadius: 10, border: "1px solid rgba(99,102,241,0.12)" }}>
                        <p style={{ fontSize: 9, color: "#818cf8", marginBottom: 3, display: "flex", alignItems: "center", gap: 2, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                          <Target size={8} /> هدف إغلاق الغد
                        </p>
                        <p style={{ fontSize: 13, fontWeight: 700, color: "#22C55E" }}>
                          {rec.predictedEndPrice.toFixed(2)}
                          <span style={{ fontSize: 9, color: "var(--text-muted)", marginLeft: 2 }}>EGP</span>
                        </p>
                      </div>
                      <div style={{ padding: "8px 10px", background: "rgba(255,255,255,0.03)", borderRadius: 10 }}>
                        <p style={{ fontSize: 9, color: "var(--text-muted)", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.05em" }}>السعر الحالي</p>
                        {rec.livePrice ? (
                          <>
                            <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>
                              {rec.livePrice.toFixed(2)}
                              <span style={{ fontSize: 9, color: "var(--text-muted)", marginLeft: 2 }}>EGP</span>
                            </p>
                            <p style={{ fontSize: 10, fontWeight: 600, color: rec.dayChange >= 0 ? "#22C55E" : "#EF4444", marginTop: 1 }}>
                              {rec.dayChange >= 0 ? "+" : ""}{rec.dayChange.toFixed(2)}% اليوم
                            </p>
                          </>
                        ) : (
                          <p style={{ fontSize: 12, color: "var(--text-muted)" }}>—</p>
                        )}
                      </div>
                    </div>

                    {/* Upside + stats row */}
                    <div style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "10px 12px", borderRadius: 10,
                      background: rec.remainingUpside > 0 ? "rgba(34,197,94,0.06)" : "rgba(239,68,68,0.06)",
                      border: `1px solid ${rec.remainingUpside > 0 ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)"}`,
                    }}>
                      <div>
                        <p style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 2 }}>الصعود المتبقي للهدف</p>
                        <p style={{ fontSize: 18, fontWeight: 800, color: rec.remainingUpside > 0 ? "#22C55E" : "#EF4444" }}>
                          {rec.remainingUpside > 0 ? "+" : ""}{rec.remainingUpside.toFixed(1)}%
                        </p>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <p style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 2 }}>الدقة التاريخية</p>
                        {rec.accuracyRecord && rec.accuracyRecord.total >= 2 ? (
                          <p style={{ fontSize: 14, fontWeight: 700, color: "#818cf8" }}>
                            {Math.round((rec.accuracyRecord.correct / rec.accuracyRecord.total) * 100)}%
                            <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: 4 }}>
                              ({rec.accuracyRecord.correct}/{rec.accuracyRecord.total})
                            </span>
                          </p>
                        ) : (
                          <p style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>جديد</p>
                        )}
                      </div>
                    </div>

                    {/* Footer */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
                      <span style={{ fontSize: 10, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 3 }}>
                        <Clock size={9} /> منذ {rec.ageDays === 0 ? "اليوم" : `${rec.ageDays} يوم`}
                      </span>
                      <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                        إطار زمني: {rec.predictionDays} يوم (تداول) · ↑{rec.predictedHigh.toFixed(1)} ↓{rec.predictedLow.toFixed(1)}
                      </span>
                      <button
                        onClick={() => predictKronos(rec.symbol)}
                        style={{
                          background: "rgba(99,102,241,0.12)", color: "#818cf8",
                          border: "1px solid rgba(99,102,241,0.25)",
                          padding: "4px 10px", borderRadius: 8,
                          fontSize: 11, fontWeight: 600, cursor: "pointer",
                          display: "flex", alignItems: "center", gap: 4,
                          transition: "all 0.15s",
                        }}
                      >
                        <BrainCircuit size={11} /> تحديث التوقع
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Note */}
          {kronosRecs?.stats?.generatedAt && (
            <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 16, textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
              <Clock size={10} />
              آخر تحديث: {new Date(kronosRecs.stats.generatedAt).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}
              &nbsp;·&nbsp;نقاط الاقتناع = الصعود المتوقع + دقة الماضي + حداثة التوقع
            </p>
          )}
        </div>
      )}

      {/* ── Footer ── */}
      <div style={{ marginTop: 24, textAlign: "center" }}>
        <p style={{ fontSize: 11, color: "var(--text-muted)" }}>
          <Zap size={10} style={{ display: "inline", marginRight: 4 }} />
          تنبيهات تلقائية كل 30 دقيقة · الأحد–الخميس 10:00–14:30 · TradingView
        </p>
      </div>

      {kronosSymbol && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,0.8)", zIndex: 1000,
          display: "flex", justifyContent: "center", alignItems: "center", padding: 20
        }}>
          <div style={{
            background: "#111", border: "1px solid rgba(99,102,241,0.3)",
            borderRadius: 16, padding: 24, width: "100%", maxWidth: 600,
            boxShadow: "0 20px 40px rgba(0,0,0,0.5), 0 0 40px rgba(99,102,241,0.1) inset"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: 18, fontWeight: 700, color: "#818cf8", display: "flex", alignItems: "center", gap: 8 }}>
                  <BrainCircuit size={18} /> مسار الذكاء الاصطناعي (Kronos-AI)
                </h3>
                <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                  {kronosSymbol} · توقعات {kronosData ? "الغد" : "..."}
                </p>
              </div>
              <button 
                onClick={() => setKronosSymbol(null)}
                style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer" }}
              >
                <X size={20} />
              </button>
            </div>

            {kronosLoading && (
               <div style={{ padding: "40px 0", textAlign: "center" }}>
                 <div className="skeleton" style={{ width: 60, height: 60, borderRadius: "50%", margin: "0 auto 16px" }} />
                 <p style={{ color: "#818cf8", fontWeight: 600 }}>جاري تحليل البيانات التاريخية...</p>
                 <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>يتم الآن معالجة 400 شمعة عبر نموذج Kronos</p>
               </div>
            )}

            {!kronosLoading && kronosData?.forecast && (
               <>
                 <div style={{ display: "flex", gap: 10, margin: "10px 0 20px" }}>
                    <div style={{ flex: 1, background: "rgba(255,255,255,0.03)", padding: "12px", borderRadius: 10, textAlign: "center" }}>
                       <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>السعر الحالي</p>
                       <p style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>{kronosData.currentPrice.toFixed(2)} EGP</p>
                    </div>
                    {(() => {
                       const lastPred = kronosData.forecast[kronosData.forecast.length - 1].close;
                       const pct = ((lastPred - kronosData.currentPrice) / kronosData.currentPrice) * 100;
                       return (
                         <div style={{ flex: 1, background: "rgba(255,255,255,0.03)", padding: "12px", borderRadius: 10, textAlign: "center" }}>
                            <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>هدف الغد</p>
                            <p style={{ fontSize: 16, fontWeight: 700, color: pct >= 0 ? "#22C55E" : "#EF4444" }}>
                               {lastPred.toFixed(2)} EGP <span style={{ fontSize: 12 }}>({pct > 0 ? "+" : ""}{pct.toFixed(2)}%)</span>
                            </p>
                         </div>
                       );
                    })()}
                 </div>
                 <div style={{ margin: "0 -10px" }}>
                   <Chart
                      options={{
                        chart: { type: "area", animations: { enabled: false }, toolbar: { show: false }, background: "transparent" },
                        colors: ["#818cf8"], fill: { type: "gradient", gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0, stops: [0, 100] } },
                        dataLabels: { enabled: false }, stroke: { curve: "smooth", width: 2 },
                        xaxis: { type: "datetime", labels: { style: { colors: "#666" } }, axisBorder: { show: false }, axisTicks: { show: false } },
                        yaxis: { labels: { formatter: (v: number) => v.toFixed(2), style: { colors: "#666" } } },
                        grid: { borderColor: "rgba(255,255,255,0.05)", strokeDashArray: 4 },
                        theme: { mode: "dark" },
                        tooltip: { x: { format: "dd MMM yyyy" }, theme: "dark" }
                      }}
                      series={[{ name: "Predicted Price", data: kronosData.forecast.map((f: any) => [new Date(f.timestamp).getTime(), f.close]) }]}
                      type="area"
                      height={250}
                   />
                 </div>
               </>
            )}
          </div>
        </div>
      )}

      {/* ── PAPER TRADING P&L TAB ── */}
      {tab === "paper" && (
        <div>
          {/* How-it-works banner */}
          <div style={{
            marginBottom: 16, padding: "14px 20px", borderRadius: 14, direction: "rtl",
            background: "linear-gradient(135deg, rgba(34,197,94,0.07) 0%, rgba(34,197,94,0.02) 100%)",
            border: "1px solid rgba(34,197,94,0.2)",
            display: "flex", alignItems: "flex-start", gap: 12,
          }}>
            <span style={{ fontSize: 20, flexShrink: 0 }}>💡</span>
            <div>
              <p style={{ fontSize: 13, fontWeight: 700, color: "#22C55E", marginBottom: 4 }}>كيف يعمل Paper Trading؟</p>
              <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.7 }}>
                كرون Kronos يعمل <b style={{ color: "var(--text-primary)" }}>كل دقيقة</b> ويحلّل
                <b style={{ color: "var(--text-primary)" }}> 5 أسهم</b> في كل دورة (≈300 سهم/ساعة).
                عند توقع ارتفاع → يُفتح تلقائياً Paper Trade بـ 1000 جنيه افتراضي.
                بعد 24 ساعة يُغلق ويقارن بسعر الإغلاق الفعلي. عدد الصفقات الحالي قليل لأن النظام
                <b style={{ color: "#EAB308" }}> بدأ حديثاً</b> — سيزداد بشكل ملحوظ خلال 24-48 ساعة القادمة.
              </p>
            </div>
          </div>

          {/* Stats Overview */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 20 }}>

            {/* Total P&L */}
            <div className="glass-card" style={{
              padding: "20px", textAlign: "center",
              background: (paperData?.stats?.totalPnlPct ?? 0) >= 0
                ? "linear-gradient(135deg, rgba(34,197,94,0.1) 0%, rgba(34,197,94,0.03) 100%)"
                : "linear-gradient(135deg, rgba(239,68,68,0.1) 0%, rgba(239,68,68,0.03) 100%)",
              border: `1px solid ${(paperData?.stats?.totalPnlPct ?? 0) >= 0 ? "rgba(34,197,94,0.25)" : "rgba(239,68,68,0.25)"}`,
            }}>
              <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>إجمالي العائد</p>
              {paperLoading ? <div className="skeleton" style={{ width: 80, height: 36, margin: "0 auto" }} /> : (
                <p style={{ fontSize: 28, fontWeight: 800, color: (paperData?.stats?.totalPnlPct ?? 0) >= 0 ? "#22C55E" : "#EF4444" }}>
                  {(paperData?.stats?.totalPnlPct ?? 0) > 0 ? "+" : ""}{paperData?.stats?.totalPnlPct ?? 0}%
                </p>
              )}
              <p style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
                {(paperData?.stats?.totalPnlEgp ?? 0) > 0 ? "+" : ""}{paperData?.stats?.totalPnlEgp ?? 0} EGP / 1000
              </p>
            </div>

            {/* Win Rate */}
            <div className="glass-card" style={{ padding: "20px", textAlign: "center" }}>
              <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>نسبة النجاح</p>
              {paperLoading ? <div className="skeleton" style={{ width: 60, height: 36, margin: "0 auto" }} /> : (
                <p style={{ fontSize: 28, fontWeight: 800, color: (paperData?.stats?.winRate ?? 0) >= 50 ? "#22C55E" : "#EF4444" }}>
                  {paperData?.stats?.winRate ?? "—"}{paperData?.stats?.winRate !== null ? "%" : ""}
                </p>
              )}
              <p style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
                ✅ {paperData?.stats?.wins ?? 0} ربح · ❌ {paperData?.stats?.losses ?? 0} خسارة
              </p>
            </div>

            {/* Total Trades */}
            <div className="glass-card" style={{ padding: "20px", textAlign: "center" }}>
              <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>إجمالي الصفقات</p>
              {paperLoading ? <div className="skeleton" style={{ width: 40, height: 36, margin: "0 auto" }} /> : (
                <p style={{ fontSize: 28, fontWeight: 800, color: "var(--text-primary)" }}>
                  {paperData?.stats?.totalTrades ?? 0}
                </p>
              )}
              <p style={{ fontSize: 10, color: "#818cf8", marginTop: 4 }}>
                ⏳ {paperData?.stats?.pendingTrades ?? 0} قيد الانتظار
              </p>
            </div>

            {/* High Consensus Win Rate */}
            <div className="glass-card" style={{
              padding: "20px", textAlign: "center",
              background: "linear-gradient(135deg, rgba(99,102,241,0.08) 0%, rgba(139,92,246,0.04) 100%)",
              border: "1px solid rgba(99,102,241,0.2)",
            }}>
              <p style={{ fontSize: 11, color: "#818cf8", marginBottom: 6 }}>دقة الإجماع العالي</p>
              {paperLoading ? <div className="skeleton" style={{ width: 60, height: 36, margin: "0 auto" }} /> : (
                <p style={{ fontSize: 28, fontWeight: 800, color: "#818cf8" }}>
                  {paperData?.stats?.highConsensusWinRate ?? "—"}{paperData?.stats?.highConsensusWinRate !== null ? "%" : ""}
                </p>
              )}
              <p style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
                3/4+ إشارات متفقة ({paperData?.stats?.highConsensusTrades ?? 0} صفقة)
              </p>
            </div>
          </div>

          {/* Compounding Simulator */}
          <div className="glass-card" style={{
            padding: "20px 24px", marginBottom: 20,
            background: "linear-gradient(135deg, rgba(234,179,8,0.08) 0%, rgba(234,179,8,0.02) 100%)",
            border: "1px solid rgba(234,179,8,0.2)",
          }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: "#EAB308", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
              <Trophy size={14} /> محاكاة الأرباح المركبة
            </p>
            {paperLoading ? <div className="skeleton" style={{ width: "100%", height: 50 }} /> : (
              <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
                <div style={{ textAlign: "center" }}>
                  <p style={{ fontSize: 10, color: "var(--text-muted)" }}>رأس المال الابتدائي</p>
                  <p style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>
                    {(paperData?.stats?.startingBalance ?? 10000).toLocaleString()} EGP
                  </p>
                </div>
                <span style={{ fontSize: 24, color: "var(--text-muted)" }}>→</span>
                <div style={{ textAlign: "center" }}>
                  <p style={{ fontSize: 10, color: "var(--text-muted)" }}>القيمة بعد تتبع كل إشارة</p>
                  <p style={{ fontSize: 24, fontWeight: 800, color: (paperData?.stats?.compoundedReturnPct ?? 0) >= 0 ? "#22C55E" : "#EF4444" }}>
                    {(paperData?.stats?.compoundedBalance ?? 10000).toLocaleString()} EGP
                  </p>
                </div>
                <span style={{
                  fontSize: 15, fontWeight: 800, padding: "6px 16px", borderRadius: 20,
                  background: (paperData?.stats?.compoundedReturnPct ?? 0) >= 0 ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
                  color: (paperData?.stats?.compoundedReturnPct ?? 0) >= 0 ? "#22C55E" : "#EF4444",
                  border: `1px solid ${(paperData?.stats?.compoundedReturnPct ?? 0) >= 0 ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
                }}>
                  {(paperData?.stats?.compoundedReturnPct ?? 0) > 0 ? "+" : ""}{paperData?.stats?.compoundedReturnPct ?? 0}%
                </span>
              </div>
            )}
            <p style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 10, textAlign: "center" }}>
              لو استثمرت 10,000 جنيه واتبعت كل إشارة Kronos AI مع إعادة استثمار الأرباح
            </p>
          </div>

          {/* Trade History */}
          <div className="glass-card" style={{ padding: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 10,
                background: "linear-gradient(135deg, #22C55E 0%, #16a34a 100%)",
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 0 14px rgba(34,197,94,0.4)",
              }}>
                <DollarSign size={16} color="#fff" />
              </div>
              <div>
                <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>سجل Paper Trading</h2>
                <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>كل صفقة ورقية تلقائية من Kronos AI + Ensemble</p>
              </div>
              <button className="btn-ghost" onClick={() => { setPaperData(null); fetchPaperTrades(); }}
                style={{ marginLeft: "auto", padding: "6px 12px", display: "flex", alignItems: "center", gap: 5, fontSize: 12 }}>
                <RefreshCw size={12} /> تحديث
              </button>
            </div>

            {paperLoading ? (
              [...Array(5)].map((_, i) => <div key={i} className="skeleton" style={{ height: 60, borderRadius: 12, marginBottom: 8 }} />)
            ) : !paperData?.trades?.length ? (
              <div style={{ textAlign: "center", padding: "50px 20px", color: "var(--text-muted)" }}>
                <DollarSign size={40} style={{ margin: "0 auto 16px", opacity: 0.2 }} />
                <p style={{ fontSize: 15, fontWeight: 600 }}>لا توجد صفقات ورقية بعد</p>
                <p style={{ fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>
                  عندما يتوقع Kronos AI ارتفاع سهم، سيفتح صفقة ورقية تلقائياً<br />
                  ويتحقق من النتيجة بعد 24 ساعة
                </p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {paperData.trades.map((trade: any, i: number) => {
                  const isSettled = trade.settled;
                  const isWin = trade.directionCorrect === true;
                  const bc = isSettled ? (isWin ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)") : "rgba(99,102,241,0.15)";
                  const bg = isSettled ? (isWin ? "rgba(34,197,94,0.03)" : "rgba(239,68,68,0.03)") : "rgba(99,102,241,0.03)";
                  return (
                    <div key={trade.id || i} style={{
                      padding: "12px 16px", borderRadius: 12,
                      background: bg, border: `1px solid ${bc}`,
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      flexWrap: "wrap", gap: 8,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 18 }}>{isSettled ? (isWin ? "✅" : "❌") : "⏳"}</span>
                        <div>
                          <span style={{ fontSize: 14, fontWeight: 800, color: "var(--text-primary)" }}>{trade.symbol}</span>
                          <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: 6 }}>
                            {new Date(trade.entryDate).toLocaleDateString("ar-EG", { month: "short", day: "numeric" })}
                          </span>
                          <div style={{ display: "flex", gap: 8, marginTop: 3, fontSize: 10, color: "var(--text-muted)" }}>
                            <span>دخول: {trade.entryPrice?.toFixed(2)}</span>
                            {trade.exitPrice && <span>خروج: {trade.exitPrice?.toFixed(2)}</span>}
                            <span>هدف: {trade.predictedPrice?.toFixed(2)}</span>
                          </div>
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: "3px 8px", borderRadius: 12,
                          background: (trade.consensusCount ?? 0) >= 3 ? "rgba(34,197,94,0.12)" : (trade.consensusCount ?? 0) >= 2 ? "rgba(234,179,8,0.12)" : "rgba(255,255,255,0.05)",
                          color: (trade.consensusCount ?? 0) >= 3 ? "#22C55E" : (trade.consensusCount ?? 0) >= 2 ? "#EAB308" : "var(--text-muted)",
                          border: `1px solid ${(trade.consensusCount ?? 0) >= 3 ? "rgba(34,197,94,0.25)" : (trade.consensusCount ?? 0) >= 2 ? "rgba(234,179,8,0.25)" : "rgba(255,255,255,0.1)"}`,
                        }}>
                          {trade.consensusCount ?? 0}/4 إجماع
                        </span>
                        {isSettled ? (
                          <span style={{ fontSize: 13, fontWeight: 800, color: (trade.pnlPct ?? 0) >= 0 ? "#22C55E" : "#EF4444" }}>
                            {(trade.pnlPct ?? 0) > 0 ? "+" : ""}{trade.pnlPct?.toFixed(2)}%
                          </span>
                        ) : (
                          <span style={{ fontSize: 11, color: "#818cf8", fontWeight: 600 }}>قيد الانتظار</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>

  );
}
