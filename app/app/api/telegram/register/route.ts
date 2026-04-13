import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * GET /api/telegram/register
 * Call this once manually to register the webhook URL with Telegram.
 * Visit: https://YOUR_DOMAIN/api/telegram/register
 */
export async function GET(req: Request) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "TELEGRAM_BOT_TOKEN not set" }, { status: 500 });
  }

  const host = req.headers.get("host") || "";
  const proto = host.includes("localhost") ? "http" : "https";
  const webhookUrl = `${proto}://${host}/api/telegram/webhook`;

  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: webhookUrl }),
  });

  const data = await res.json();
  return NextResponse.json({ webhookUrl, telegramResponse: data });
}
