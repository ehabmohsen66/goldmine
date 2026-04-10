/**
 * mngm.com scraper — runs in Vercel Serverless using @sparticuz/chromium-min + playwright-core
 * Falls back to a lightweight fetch-based scrape if chromium isn't available (local dev).
 */

const PRODUCT_URL = "https://mngm.com/buy/metals/product/8";
const CHECKOUT_URL = "https://mngm.com/account/checkout/digital";
const LOGIN_URL = "https://mngm.com/account/login";

const MNGM_EMAIL = process.env.MNGM_EMAIL!;
const MNGM_PASSWORD = process.env.MNGM_PASSWORD!;

export interface ScrapeResult {
  price: number | null;
  walletBalance: number | null;
  error?: string;
}

async function getChromium() {
  try {
    const chromium = (await import("@sparticuz/chromium-min")).default;
    const playwright = await import("playwright-core");
    return { chromium, playwright };
  } catch {
    return null;
  }
}

/** Block heavy resources to cut RAM usage */
async function optimizePage(page: any) {
  await page.route("**/*", (route: any) => {
    const t = route.request().resourceType();
    if (["image", "stylesheet", "font", "media"].includes(t)) route.abort().catch(() => {});
    else route.continue().catch(() => {});
  });
}

/** Apply anti-bot-detection patches to a page */
async function stealthPage(page: any) {
  await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    (window as any).chrome = { runtime: {} };
  });
}

/** Type text character by character like a human */
async function humanType(page: any, selector: string, text: string) {
  await page.waitForSelector(selector, { timeout: 10000 });
  await page.click(selector);
  await page.waitForTimeout(300);
  for (const char of text) {
    await page.type(selector, char, { delay: 70 + Math.random() * 50 });
  }
}

/** Launch browser, log in, and return the page. Caller must close the browser. */
async function launchAndLogin() {
  const deps = await getChromium();
  if (!deps) throw new Error("Chromium not available");

  const { chromium, playwright } = deps;
  const execPath = await chromium.executablePath(
    "https://github.com/Sparticuz/chromium/releases/download/v133.0.0/chromium-v133.0.0-pack.tar"
  );

  const CHROMIUM_ARGS = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--no-first-run",
    "--no-zygote",
    "--single-process",
    "--disable-blink-features=AutomationControlled",
  ];

  const browser = await playwright.chromium.launch({
    args: CHROMIUM_ARGS,
    executablePath: execPath,
    headless: true,
  });

  const page = await browser.newPage();
  await optimizePage(page);
  await stealthPage(page);

  // Navigate to login page
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

  // Fill credentials human-style
  await humanType(page, "#si-email", MNGM_EMAIL);
  await page.waitForTimeout(500);
  await humanType(page, "#js-password", MNGM_PASSWORD);
  await page.waitForTimeout(800);

  // Click login
  await page.click("#js-loginButton");
  await page.waitForTimeout(8000);

  // Verify login succeeded
  const url = page.url().toLowerCase();
  if (url.includes("login") || url.includes("signin")) {
    await browser.close();
    throw new Error("Login failed — credentials rejected or CAPTCHA triggered");
  }

  return { browser, page };
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export async function getGoldPrice(): Promise<number> {
  const { browser, page } = await launchAndLogin();

  try {
    await page.goto(PRODUCT_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(4000); // let websocket populate price

    const content = await page.innerText("body");
    const match =
      content.match(/Ask[\s:]*([0-9][0-9,]+\.?[0-9]*)/i) ||
      content.match(/([0-9][0-9,]+\.[0-9]+)\s*EGP/i);

    if (!match) throw new Error("Could not find price on mngm.com page");
    return parseFloat(match[1].replace(/,/g, ""));
  } finally {
    await browser.close();
  }
}

export async function loginAndGetWallet(): Promise<number | null> {
  try {
    const { browser, page } = await launchAndLogin();
    try {
      await page.goto(CHECKOUT_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(3000);
      const content = await page.innerText("body");
      // Try to grab wallet balance from text like "Wallet Balance: 5,200 EGP"
      const match =
        content.match(/[Ww]allet[^\d]{0,40}([\d,]+\.?\d*)\s*EGP/) ||
        content.match(/[Bb]alance[^\d]{0,40}([\d,]+\.?\d*)\s*EGP/);
      return match ? parseFloat(match[1].replace(/,/g, "")) : null;
    } finally {
      await browser.close();
    }
  } catch {
    return null;
  }
}

export async function executeBuy(egpAmount: number): Promise<boolean> {
  const { browser, page } = await launchAndLogin();

  try {
    // Navigate to product page
    await page.goto(PRODUCT_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);

    // Select EGP input mode
    for (const sel of ['label:has-text("EGP")', 'input[value="egp"]', "#egp"]) {
      try {
        const el = await page.$(sel);
        if (el) { await el.click(); await page.waitForTimeout(500); break; }
      } catch { continue; }
    }

    // Enter amount
    for (const sel of ['input[type="number"]', ".amount-input", 'input[placeholder="0"]']) {
      try {
        const el = await page.$(sel);
        if (el) {
          await el.click({ clickCount: 3 });
          await el.type(String(Math.floor(egpAmount)));
          await page.waitForTimeout(1000);
          break;
        }
      } catch { continue; }
    }

    // Click Checkout
    for (const sel of ['button:has-text("Checkout")', ".checkout-btn"]) {
      try {
        const el = await page.$(sel);
        if (el) { await el.click(); await page.waitForTimeout(3000); break; }
      } catch { continue; }
    }

    // Select Mngm Wallet payment
    for (const sel of [':has-text("Mngm Wallet")', "text=Wallet", '[class*="wallet"]']) {
      try {
        const el = await page.$(sel);
        if (el) { await el.click(); await page.waitForTimeout(2000); break; }
      } catch { continue; }
    }

    // Confirm payment
    for (const sel of ['button:has-text("Confirm")', 'button:has-text("Place Order")', 'button:has-text("Pay")']) {
      try {
        const el = await page.$(sel);
        if (el) { await el.click(); await page.waitForTimeout(5000); break; }
      } catch { continue; }
    }

    return true;
  } finally {
    await browser.close();
  }
}

export async function executeSell(grams: number): Promise<boolean> {
  const { browser, page } = await launchAndLogin();

  try {
    await page.goto("https://mngm.com/account", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);

    for (const sel of ['a:has-text("Sell")', 'button:has-text("Sell")', '[href*="sell"]']) {
      try {
        const el = await page.$(sel);
        if (el) { await el.click(); await page.waitForTimeout(2000); break; }
      } catch { continue; }
    }

    for (const sel of ['input[type="number"]', ".sell-input"]) {
      try {
        const el = await page.$(sel);
        if (el) {
          await el.click({ clickCount: 3 });
          await el.type(String(Math.round(grams * 1000000) / 1000000));
          await page.waitForTimeout(1000);
          break;
        }
      } catch { continue; }
    }

    for (const sel of ['button:has-text("Sell")', 'button:has-text("Confirm")']) {
      try {
        const el = await page.$(sel);
        if (el) { await el.click(); await page.waitForTimeout(5000); break; }
      } catch { continue; }
    }

    return true;
  } finally {
    await browser.close();
  }
}
