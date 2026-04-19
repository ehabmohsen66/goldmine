import { getKronosHistory } from "./app/lib/redis.ts";
async function check() {
  const history = await getKronosHistory(500);
  console.log(`Total predictions in history: ${history.length}`);
  const bullish = history.filter(h => h.predictedChangePercent > 0);
  console.log(`Bullish predictions: ${bullish.length}`);
  if (bullish.length > 0) {
    console.log("Bullish stocks:", bullish.map(b => b.symbol).join(", "));
  } else {
    // Print the last 5 predictions
    console.log("Last 5 predictions:");
    history.slice(0, 5).forEach(h => console.log(`${h.symbol}: ${h.predictedChangePercent.toFixed(2)}%`));
  }
}
check();
