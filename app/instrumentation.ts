/**
 * Next.js Instrumentation — runs once on server startup.
 * Starts the internal tick loop so Railway doesn't need any external cron trigger.
 * Also schedules the daily EGX brief at 10:00 AM Cairo time.
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
  const EGX_URL  = `http://localhost:${PORT}/api/cron/egx`;

  // Respect CRON_SECRET if set
  const CRON_SECRET = process.env.CRON_SECRET;
  const cronHeaders: Record<string, string> = CRON_SECRET
    ? { Authorization: `Bearer ${CRON_SECRET}` }
    : {};

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
        text: "🟡 <b>Goldmine Bot Started</b>\n\nMonitoring gold prices every 60s.\nYou will be notified here when to buy or sell on MNGM.\n\n📊 EGX daily brief will be sent at 10:00 AM Cairo time.\n\n<i>Set LOW_WALLET_THRESHOLD=20 to allow 50 EGP buys.</i>",
        parse_mode: "HTML",
      }),
    }).catch(() => {});
  }

  const runTick = async () => {
    try {
      const res = await fetch(TICK_URL, {
        headers: cronHeaders,
        signal: AbortSignal.timeout(55000),
      });
      const data = await res.json();
      const price = (data as any)?.price ?? "?";
      console.log(`[goldmine] ✓ Tick — price: ${price} EGP/g | ${new Date().toISOString()}`);
    } catch (err) {
      console.error(`[goldmine] ✗ Tick error:`, err);
    }
  };

  // ── EGX alert engine scheduler ────────────────────────────────────────────
  // Runs every 30 min during EGX market hours (Sun–Thu, 10:00–14:30 Cairo).
  // The API route itself enforces the 25-min scan rate-limit & per-stock cooldowns.
  let lastEgxRun = 0;

  const runEgxScan = async () => {
    try {
      const cairoNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Africa/Cairo" }));
      const day = cairoNow.getDay();               // 0=Sun … 6=Sat
      const min = cairoNow.getHours() * 60 + cairoNow.getMinutes();
      const isWeekday = day >= 0 && day <= 4;
      const isSession = min >= 600 && min <= 870;  // 10:00–14:30

      // Always send the morning brief at open (10:00–10:04 Cairo), even if outside scan window
      const isBriefWindow = cairoNow.getHours() === 10 && cairoNow.getMinutes() < 5;

      if (!isWeekday || (!isSession && !isBriefWindow)) return;

      // Rate-limit to once per 30 min inside the process (Redis handles cross-restart dedup)
      const elapsed = Date.now() - lastEgxRun;
      if (elapsed < 28 * 60 * 1000) return;

      lastEgxRun = Date.now();
      console.log("[goldmine] ⏰ EGX scan — triggering alert engine...");

      const res = await fetch(EGX_URL, {
        headers: cronHeaders,
        signal: AbortSignal.timeout(50000),
      });
      const data = await res.json() as any;

      if (data.skipped) {
        console.log(`[goldmine] EGX scan skipped — ${data.reason}`);
      } else if (data.ok) {
        console.log(
          `[goldmine] ✓ EGX scan — ${data.scanned} stocks | ` +
          `BUY: ${data.buyAlerts?.length ?? 0} | ` +
          `SELL: ${data.sellAlerts?.length ?? 0} | ` +
          `WATCH: ${data.watchAlerts?.length ?? 0}`
        );
      } else {
        console.error(`[goldmine] ✗ EGX scan failed:`, data.error);
      }
    } catch (err) {
      console.error(`[goldmine] ✗ EGX scheduler error:`, err);
    }
  };

  // Run gold tick loop
  runTick();
  setInterval(runTick, INTERVAL_MS);

  // EGX: check every minute, the function itself rate-limits to every 30 min
  setInterval(runEgxScan, 60 * 1000);
  runEgxScan(); // run once on startup (handles redeploy during market hours)
}
