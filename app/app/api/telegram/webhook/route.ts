import { NextResponse } from "next/server";
import { getRedis, KEYS, getState, setBotEnabled, getEgxPortfolio } from "@/lib/redis";
import { getMarketStatus } from "@/lib/egx";

export const runtime = "nodejs";
export const maxDuration = 25;

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID   = process.env.TELEGRAM_CHAT_ID;

async function sendReply(chatId: string | number, text: string) {
  if (!BOT_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
}

/**
 * POST /api/telegram/webhook
 * Telegram sends all incoming messages here.
 * Register with:  https://api.telegram.org/bot{TOKEN}/setWebhook?url=https://YOUR_DOMAIN/api/telegram/webhook
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const message = body?.message;
    if (!message) return NextResponse.json({ ok: true });

    const chatId = message.chat?.id;
    const text: string = (message.text ?? "").trim().toLowerCase();

    // Only respond to your own chat (security)
    if (CHAT_ID && String(chatId) !== String(CHAT_ID)) {
      return NextResponse.json({ ok: true });
    }

    // ── /status ─────────────────────────────────────────────────────────────
    if (text === "/status" || text === "/start") {
      const state = await getState();
      const market = getMarketStatus();
      const posStr = state.in_position
        ? `📦 تحتفظ بـ <b>${state.grams_held?.toFixed(4)}g</b> بسعر <b>${state.buy_price?.toFixed(2)} EGP/g</b>`
        : `💤 لا يوجد مركز مفتوح`;
      const pnl = state.in_position && state.last_price && state.buy_price
        ? (((state.last_price - state.buy_price) / state.buy_price) * 100).toFixed(2)
        : null;
      await sendReply(chatId,
        `🤖 <b>Goldmine Bot Status</b>\n\n` +
        `🔵 الحالة: <b>${state.status === "running" ? "يعمل ✅" : state.status === "stopped" ? "متوقف ⏸" : "خطأ ❌"}</b>\n` +
        `💰 السعر الحالي: <b>${state.last_price?.toFixed(2) ?? "—"} EGP/g</b>\n` +
        `👛 الرصيد: <b>${state.wallet_balance?.toFixed(2) ?? "—"} EGP</b>\n` +
        `${posStr}\n` +
        (pnl ? `📊 الربح/الخسارة غير المحقق: <b>${Number(pnl) >= 0 ? "+" : ""}${pnl}%</b>\n` : "") +
        `💹 إجمالي الأرباح: <b>${state.total_profit?.toFixed(2) ?? 0} EGP</b>\n` +
        `🔄 الصفقات المنجزة: <b>${state.trade_count ?? 0}</b>\n\n` +
        `📅 ${market.reason}\n\n` +
        `<i>آخر تحديث: ${state.last_tick ? new Date(state.last_tick).toLocaleTimeString("ar-EG", { timeZone: "Africa/Cairo" }) : "—"}</i>`
      );
    }

    // ── /pause ───────────────────────────────────────────────────────────────
    else if (text === "/pause" || text === "/stop") {
      await setBotEnabled(false);
      await sendReply(chatId, "⏸️ <b>تم إيقاف البوت مؤقتاً.</b>\nأرسل /resume لإعادة التشغيل.");
    }

    // ── /resume ──────────────────────────────────────────────────────────────
    else if (text === "/resume" || text === "/start@bot") {
      await setBotEnabled(true);
      await sendReply(chatId, "▶️ <b>تم تشغيل البوت!</b>\nسيبدأ مراقبة الأسعار في الدقيقة القادمة.");
    }

    // ── /egx ────────────────────────────────────────────────────────────────
    else if (text === "/egx") {
      const market = getMarketStatus();
      const r = getRedis();
      const lastScan = await r.get<string>(KEYS.EGX_LAST_SCAN);
      const lastScanStr = lastScan
        ? new Date(parseInt(lastScan)).toLocaleTimeString("ar-EG", { timeZone: "Africa/Cairo" })
        : "لم يتم بعد";
      await sendReply(chatId,
        `📊 <b>البورصة المصرية</b>\n\n` +
        `${market.open ? "🟢" : "🔴"} ${market.reason}\n` +
        `🕐 آخر مسح: <b>${lastScanStr}</b>\n\n` +
        `<i>افتح التطبيق لرؤية التفاصيل الكاملة والتوصيات.</i>`
      );
    }

    // ── /portfolio ───────────────────────────────────────────────────────────
    else if (text === "/portfolio") {
      const positions = await getEgxPortfolio();
      if (positions.length === 0) {
        await sendReply(chatId, "📂 <b>المحفظة فارغة حالياً.</b>\nلم نرسل أي إشارة شراء نشطة بعد.");
      } else {
        let msg = `📂 <b>المحفظة الحالية (${positions.length} سهم)</b>\n\n`;
        for (const p of positions) {
          const ageH = Math.round((Date.now() - new Date(p.alertedAt).getTime()) / 3600000);
          msg += `• <b>${p.symbol}</b> — دخلنا عند <b>${p.alertPrice.toFixed(2)} جنيه</b> — منذ ${ageH}س — إشارة: <b>${p.lastSignal.replace("_"," ")}</b>\n`;
        }
        await sendReply(chatId, msg);
      }
    }

    // ── /help ────────────────────────────────────────────────────────────────
    else if (text === "/help") {
      await sendReply(chatId,
        `🤖 <b>أوامر Goldmine Bot:</b>\n\n` +
        `/status — حالة البوت والرصيد والمركز الحالي\n` +
        `/pause — إيقاف البوت مؤقتاً\n` +
        `/resume — استئناف تشغيل البوت\n` +
        `/egx — حالة البورصة المصرية\n` +
        `/portfolio — المحفظة التلقائية الحالية\n` +
        `/help — هذه القائمة\n\n` +
        `<i>جميع الأوامر تعمل فقط من حسابك المسجل.</i>`
      );
    }

    // ── Unknown command ───────────────────────────────────────────────────────
    else if (text.startsWith("/")) {
      await sendReply(chatId, `❓ أمر غير معروف. أرسل /help لقائمة الأوامر.`);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[telegram-webhook] Error:", err);
    return NextResponse.json({ ok: true }); // always return 200 to Telegram
  }
}
