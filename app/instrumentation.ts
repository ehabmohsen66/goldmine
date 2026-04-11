/**
 * Next.js Instrumentation — runs once on server startup.
 * Starts the internal tick loop so Railway doesn't need any external cron trigger.
 */

export async function register() {
  // Only run server-side (not edge runtime)
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Only run on Railway (detected by PLAYWRIGHT_BROWSERS_PATH or SELF_TICK)
  const isServer = process.env.PLAYWRIGHT_BROWSERS_PATH || process.env.SELF_TICK || process.env.TELEGRAM_BOT_TOKEN;
  if (!isServer) return;

  const INTERVAL_MS = parseInt(process.env.TICK_INTERVAL_MS ?? "60000");
  const PORT = process.env.PORT ?? "3000";
  const TICK_URL = `http://localhost:${PORT}/api/cron/tick`;

  console.log(`[goldmine] Internal tick loop starting — every ${INTERVAL_MS / 1000}s → ${TICK_URL}`);

  // Wait for server to be fully ready before first tick
  await new Promise((r) => setTimeout(r, 5000));

  // Send Telegram startup ping
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (token && chatId) {
    fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: "🟡 <b>Goldmine Bot Started</b>\n\nMonitoring gold prices every 60s.\nYou will be notified here when to buy or sell on MNGM.\n\n<i>Set LOW_WALLET_THRESHOLD=20 to allow 50 EGP buys.</i>",
        parse_mode: "HTML",
      }),
    }).catch(() => {});
  }

  const runTick = async () => {
    try {
      const res = await fetch(TICK_URL, { signal: AbortSignal.timeout(55000) });
      const data = await res.json();
      const price = (data as any)?.price ?? "?";
      console.log(`[goldmine] ✓ Tick — price: ${price} EGP/g | ${new Date().toISOString()}`);
    } catch (err) {
      console.error(`[goldmine] ✗ Tick error:`, err);
    }
  };

  // Run immediately then on interval
  runTick();
  setInterval(runTick, INTERVAL_MS);
}
