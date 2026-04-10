/**
 * MNGM WebSocket price feed — uses their SignalR hub at wss://api-feed.mngm.com/feedhub
 * Gets live gold price in ~200ms instead of 15+ seconds of browser scraping.
 */

const FEED_HUB_URL = "https://api-feed.mngm.com/feedhub";
const GOLD_PRODUCT_ID = 8; // fractional gold product ID (from the URL /buy/metals/product/8)

export async function getPriceFromFeed(timeoutMs = 10000): Promise<number | null> {
  try {
    const { HubConnectionBuilder, LogLevel } = await import("@microsoft/signalr");

    return await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => {
        connection.stop().catch(() => {});
        resolve(null);
      }, timeoutMs);

      const connection = new HubConnectionBuilder()
        .withUrl(FEED_HUB_URL)
        .configureLogging(LogLevel.None)
        .build();

      // Listen for price updates — MNGM broadcasts on "ReceiveProductPrices"
      connection.on("ReceiveProductPrices", (data: any) => {
        try {
          // data is likely an array of { productId, ask, bid, ... }
          const items: any[] = Array.isArray(data) ? data : [data];
          const gold = items.find(
            (d: any) => d?.productId === GOLD_PRODUCT_ID || d?.id === GOLD_PRODUCT_ID
          );
          const price = gold?.ask ?? gold?.askPrice ?? gold?.price ?? null;
          if (price && parseFloat(price) > 0) {
            clearTimeout(timer);
            connection.stop().catch(() => {});
            resolve(parseFloat(price));
          }
        } catch {
          // try next message
        }
      });

      // Also listen on alternative event names
      for (const evt of ["PriceUpdate", "ReceivePrices", "price", "ProductPrice"]) {
        connection.on(evt, (data: any) => {
          try {
            const raw = JSON.stringify(data);
            const match = raw.match(/"ask(?:Price)?"\s*:\s*([\d.]+)/i) ||
                          raw.match(/"price"\s*:\s*([\d.]+)/i);
            if (match) {
              clearTimeout(timer);
              connection.stop().catch(() => {});
              resolve(parseFloat(match[1]));
            }
          } catch {}
        });
      }

      connection.start().catch(() => {
        clearTimeout(timer);
        resolve(null);
      });
    });
  } catch {
    return null;
  }
}
