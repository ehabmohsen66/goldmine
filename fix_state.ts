import { getRedis, KEYS, Trade } from "./app/lib/redis";

async function run() {
  const r = getRedis();
  const raw = await r.lrange(KEYS.TRADES, 0, 100);
  const trades: Trade[] = raw.map((item) => (typeof item === "string" ? JSON.parse(item) : item));
  
  console.log("Found", trades.length, "trades");
  const filtered = trades.filter(t => !(t.action === "SELL" && t.grams === 0.001));
  console.log("Filtered to", filtered.length, "trades");
  
  await r.del(KEYS.TRADES);
  if (filtered.length > 0) {
    for (const t of filtered.reverse()) { // reverse back to insert in correct order
       await r.lpush(KEYS.TRADES, JSON.stringify(t));
    }
  }
  
  const state = await r.get("goldmine:state");
  if (state) {
     state.in_position = false;
     state.grams_held = null;
     state.buy_price = null;
     await r.set("goldmine:state", state);
  }
  console.log("Done");
}

run().catch(console.error);
