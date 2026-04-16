import { NextResponse } from "next/server";
import { scanAllEgx } from "@/lib/egx";
import { getRedis, saveEgxThndrPortfolio } from "@/lib/redis";

export const runtime = "nodejs";
export const maxDuration = 30;

const CACHE_KEY = "goldmine:egx_scan_all_cache";
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export async function POST(req: Request) {
  const apiSecret = process.env.API_SECRET;
  if (apiSecret) {
    const incoming = req.headers.get("x-api-secret");
    if (incoming !== apiSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  try {
    const body = await req.json();
    const portfolio: { symbol: string; buyPrice: number; shares?: number }[] = body.portfolio || [];
    const saveToProfile = body.save === true;

    if (!Array.isArray(portfolio) || portfolio.length === 0) {
      return NextResponse.json(
        { error: "Invalid portfolio format. Expected { portfolio: [{ symbol: 'COMI', buyPrice: 70, shares: 1000 }] }" },
        { status: 400 }
      );
    }

    if (saveToProfile) {
      // Normalize shares properly before saving
      const cleaned = portfolio.map(p => ({
        symbol: p.symbol,
        buyPrice: p.buyPrice,
        shares: p.shares || 0
      }));
      await saveEgxThndrPortfolio(cleaned);
    }

    const r = getRedis();
    let allStocks: Awaited<ReturnType<typeof scanAllEgx>> | null = null;
    
    // Try to get from cache first to avoid hitting TV API rate limits
    try {
      const cached = await r.get<{ data: typeof allStocks; ts: number }>(CACHE_KEY);
      if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
        allStocks = cached.data;
      }
    } catch { /* ignore redis error */ }

    if (!allStocks) {
      allStocks = await scanAllEgx(200);
      try {
        await r.set(CACHE_KEY, { data: allStocks, ts: Date.now() }, { ex: 600 });
      } catch { /* ignore redis error */ }
    }

    const recommendations = portfolio.map((item) => {
      // Find the stock (handle variations like with or without .CA)
      const stock = allStocks!.find(
        (s) =>
          s.symbol === item.symbol ||
          s.symbol === item.symbol.replace(".CA", "") ||
          s.symbol + ".CA" === item.symbol
      );

      if (!stock) {
        return {
          symbol: item.symbol,
          buyPrice: item.buyPrice,
          shares: item.shares ?? 0,
          error: "Stock not found in current EGX market data.",
        };
      }

      const pnlPct = ((stock.price - item.buyPrice) / item.buyPrice) * 100;
      let recommendationType = "HOLD";
      let recommendationText = "الاحتفاظ بالسهم (لا توجد إشارة واضحة للبيع أو الشراء حالياً).";

      if (stock.signal === "SELL" || stock.signal === "STRONG_SELL") {
        if (pnlPct > 0) {
          recommendationType = "TAKE_PROFIT";
          recommendationText = "جني أرباح (السهم محقق ربح وتوجد إشارة بيع سلبية).";
        } else {
          recommendationType = "CUT_LOSS";
          recommendationText = "وقف خسارة (إشارة سلبية واضحة. الأفضل تقليل التعرض أو الخروج لحماية رأس المال).";
        }
      } else if (stock.signal === "STRONG_BUY") {
        if (pnlPct < -4) {
          recommendationType = "AVERAGE_DOWN";
          recommendationText = "عمل متوسط (إشارة شراء قوية جداً والسهم يتداول أقل من سعر شرائك). فرصة جيدة لتقليل متوسط التكلفة.";
        } else {
          recommendationType = "BUY_MORE";
          recommendationText = "زيادة الكمية (إشارة شراء قوية والاتجاه إيجابي لتعزيز الأرباح).";
        }
      } else if (stock.signal === "BUY") {
        if (pnlPct < 0) {
          recommendationType = "HOLD";
          recommendationText = "احتفاظ ומراقبة (بدأت تظهر إشارات إيجابية، انتظر حتى يتحول للون الأخضر القوي).";
        } else {
          recommendationType = "HOLD";
          recommendationText = "احتفاظ (السهم في اتجاه صاعد ومحقق ربح، دعه يستمر حتى تظهر إشارة بيع).";
        }
      } else if (stock.signal === "HOLD") {
        if (pnlPct > 15) {
          recommendationType = "TAKE_PROFIT";
          recommendationText = "إشارة السوق محايدة ولكن الربح ممتاز. يمكنك جني جزء من الأرباح لتأمينها.";
        } else if (pnlPct < -10) {
          recommendationType = "HOLD";
          recommendationText = "احتفاظ (خسارة حالية ولكن السوق محايد، لا داعي للبيع على خسارة في الوقت الحالي).";
        } else {
          recommendationType = "HOLD";
          recommendationText = "احتفاظ ومتابعة (لا توجد حركة قوية، المؤشرات محايدة).";
        }
      }

      return {
        symbol: stock.symbol,
        name: stock.name,
        buyPrice: item.buyPrice,
        currentPrice: stock.price,
        shares: item.shares ?? 0,
        pnlPct: pnlPct,
        pnlAbs: item.shares ? (stock.price - item.buyPrice) * item.shares : 0,
        signal: stock.signal,
        score: stock.score,
        rsi: stock.rsi,
        recommendationType,
        recommendationText,
      };
    });

    return NextResponse.json({
      recommendations,
      scannedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
