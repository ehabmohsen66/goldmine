"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  TrendingUp, TrendingDown, RefreshCw, BarChart3,
  Activity, AlertTriangle, ChevronLeft, Zap, Clock,
  ArrowUpRight, ArrowDownRight, Briefcase, Bell,
} from "lucide-react";


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

function StockRow({ stock }: { stock: EgxStock }) {
  const isPos = stock.change >= 0;
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "1fr auto auto auto",
      gap: 10, alignItems: "center",
      padding: "10px 14px", borderRadius: 10,
      background: "rgba(255,255,255,0.02)",
      border: "1px solid rgba(255,255,255,0.05)", marginBottom: 6,
    }}>
      <div>
        <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{stock.symbol}</p>
        <p style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{stock.name}</p>
      </div>
      {stock.rsi !== null && (
        <span style={{ fontSize: 11, color: stock.rsi < 30 ? "#22C55E" : stock.rsi > 70 ? "#EF4444" : "var(--text-muted)" }}>
          RSI {stock.rsi.toFixed(0)}
        </span>
      )}
      <span style={{ fontSize: 12, fontWeight: 700, color: isPos ? "#22C55E" : "#EF4444", display: "flex", alignItems: "center", gap: 2 }}>
        {isPos ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
        {isPos ? "+" : ""}{stock.change.toFixed(2)}%
      </span>
      <span style={{
        fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 5,
        background: `${signalColor(stock.signal)}22`,
        border: `1px solid ${signalColor(stock.signal)}44`,
        color: signalColor(stock.signal), whiteSpace: "nowrap",
      }}>
        {stock.signal.replace("_", " ")}
      </span>
    </div>
  );
}

function PortfolioCard({ pos }: { pos: EgxPosition }) {
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
        <span style={{
          fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 5,
          background: `${sc}22`, border: `1px solid ${sc}44`, color: sc,
        }}>
          {pos.lastSignal.replace("_", " ")}
        </span>
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
  const [tab, setTab]               = useState<"market" | "portfolio" | "history">("market");
  const [strongBuyOnly, setStrongBuyOnly] = useState(false);
  
  // AI Upload State
  const [analyzingImage, setAnalyzingImage] = useState(false);
  const [aiError, setAiError] = useState("");
  const [recommendations, setRecommendations] = useState<any[] | null>(null);

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
              ov?.topBuys.length ? ov.topBuys.map(s => <StockRow key={s.symbol} stock={s} />) :
              <p style={{ color: "var(--text-muted)", fontSize: 13 }}>لا توجد إشارات شراء حالياً</p>}
          </div>

          <div className="glass-card" style={{ padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <Activity size={15} color="#EAB308" />
              <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>مراقبة — RSI منخفض</h2>
            </div>
            <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 10 }}>RSI {"<"} 35 · ارتداد محتمل</p>
            {loading ? [...Array(3)].map((_, i) => <div key={i} className="skeleton" style={{ height: 52, borderRadius: 10, marginBottom: 6 }} />) :
              ov?.watchlist.length ? ov.watchlist.map(s => <StockRow key={s.symbol} stock={s} />) :
              <p style={{ color: "var(--text-muted)", fontSize: 13 }}>لا توجد أسهم ذات RSI منخفض</p>}
          </div>

          <div className="glass-card" style={{ padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <ArrowUpRight size={15} color="#22C55E" />
              <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>الأكثر ارتفاعاً</h2>
            </div>
            {loading ? [...Array(3)].map((_, i) => <div key={i} className="skeleton" style={{ height: 52, borderRadius: 10, marginBottom: 6 }} />) :
              ov?.topGainers.length ? ov.topGainers.map(s => <StockRow key={s.symbol} stock={s} />) :
              <p style={{ color: "var(--text-muted)", fontSize: 13 }}>لا توجد بيانات</p>}
          </div>

          <div className="glass-card" style={{ padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <ArrowDownRight size={15} color="#EF4444" />
              <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>الأكثر انخفاضاً</h2>
            </div>
            {loading ? [...Array(3)].map((_, i) => <div key={i} className="skeleton" style={{ height: 52, borderRadius: 10, marginBottom: 6 }} />) :
              ov?.topLosers.length ? ov.topLosers.map(s => <StockRow key={s.symbol} stock={s} />) :
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
              visiblePortfolio.map(p => <PortfolioCard key={p.symbol} pos={p} />)
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

      {/* ── Footer ── */}
      <div style={{ marginTop: 24, textAlign: "center" }}>
        <p style={{ fontSize: 11, color: "var(--text-muted)" }}>
          <Zap size={10} style={{ display: "inline", marginRight: 4 }} />
          تنبيهات تلقائية كل 30 دقيقة · الأحد–الخميس 10:00–14:30 · TradingView
        </p>
      </div>
    </div>
  );
}
