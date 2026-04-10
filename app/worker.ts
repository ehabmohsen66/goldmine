/**
 * Railway worker entry point.
 * Runs the gold bot tick loop every minute as a persistent background process.
 * No external cron trigger needed — this stays alive 24/7.
 */

import { createServer } from "http";

const TICK_URL = process.env.TICK_URL ?? "http://localhost:3000/api/cron/tick";
const TICK_INTERVAL_MS = parseInt(process.env.TICK_INTERVAL_MS ?? "60000");

async function runTick() {
  try {
    const res = await fetch(TICK_URL);
    const data = await res.json();
    console.log(`[${new Date().toISOString()}] Tick:`, JSON.stringify(data).slice(0, 200));
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Tick error:`, err);
  }
}

async function main() {
  console.log(`[goldmine] Worker starting. Tick every ${TICK_INTERVAL_MS / 1000}s`);

  // Run immediately on start
  await runTick();

  // Then run on interval
  setInterval(runTick, TICK_INTERVAL_MS);

  // Keep process alive with a minimal health-check server
  const server = createServer((req, res) => {
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, service: "goldmine-worker" }));
  });

  const port = parseInt(process.env.PORT ?? "8080");
  server.listen(port, () => {
    console.log(`[goldmine] Health check listening on port ${port}`);
  });
}

main().catch(console.error);
