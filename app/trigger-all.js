const fetch = require('node-fetch');

async function trigger() {
  console.log("Fetching daily brief...");
  const briefRes = await fetch("https://goldmine-production-f681.up.railway.app/api/egx/brief");
  const brief = await briefRes.json();
  
  if (!brief || !brief.overview) {
    console.error("Failed to fetch brief");
    return;
  }
  
  const targetStocks = [
    ...brief.overview.topBuys,
    ...brief.overview.watchlist,
    ...brief.overview.topGainers
  ];
  
  const uniqueSymbols = Array.from(new Set(targetStocks.map(s => s.symbol)));
  const symbolsToPredict = uniqueSymbols.slice(0, 10);
  
  console.log("Target symbols:", symbolsToPredict);
  
  for (const symbol of symbolsToPredict) {
    console.log(`Triggering forecast for ${symbol}...`);
    try {
      const res = await fetch("https://goldmine-production-f681.up.railway.app/api/egx/forecast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol })
      });
      const data = await res.json();
      if (res.ok) {
        console.log(`✅ Success for ${symbol}`);
      } else {
        console.log(`❌ Failed for ${symbol}:`, data);
      }
    } catch (e) {
      console.log(`❌ Error for ${symbol}:`, e.message);
    }
  }
  
  console.log("Done!");
}

trigger();
