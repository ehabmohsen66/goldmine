/**
 * Next.js Instrumentation — runs once on server startup.
 * Starts the internal tick loop so Railway doesn't need any external cron trigger.
 */

export async function register() {
  // Only run in the Node.js runtime (not edge), and only on Railway
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.RAILWAY_ENVIRONMENT && !process.env.SELF_TICK) return;

  const INTERVAL_MS = parseInt(process.env.TICK_INTERVAL_MS ?? "60000");
  const PORT = process.env.PORT ?? "3000";
  const TICK_URL = `http://localhost:${PORT}/api/cron/tick`;

  console.log(`[goldmine] Internal tick loop starting — every ${INTERVAL_MS / 1000}s → ${TICK_URL}`);

  // Wait for server to be fully ready before first tick
  await new Promise((r) => setTimeout(r, 5000));

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
