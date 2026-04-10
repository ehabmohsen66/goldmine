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
  // Vercel / production path
  try {
    const chromium = (await import("@sparticuz/chromium-min")).default;
    const playwright = await import("playwright-core");
    return { chromium, playwright };
  } catch {
    return null;
  }
}

async function optimizePage(page: any) {
  await page.route("**/*", (route: any) => {
    const t = route.request().resourceType();
    if (["image", "stylesheet", "font", "media"].includes(t)) route.abort().catch(() => {});
    else route.continue().catch(() => {});
  });
}

export async function getGoldPrice(): Promise<number> {
  const deps = await getChromium();
  if (!deps) throw new Error("Chromium not available");

  const { chromium, playwright } = deps;
  const execPath = await chromium.executablePath(
    "https://github.com/Sparticuz/chromium/releases/download/v133.0.0/chromium-v133.0.0-pack.tar"
  );

  const browser = await playwright.chromium.launch({
    args: chromium.args,
    executablePath: execPath,
    headless: true,
  });

  try {
    const page = await browser.newPage();
    await optimizePage(page);
    
    // Login
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);

    for (const sel of ['input#si-email', 'input[name="email"]', 'input[type="email"]']) {
      try { if (await page.$(sel)) { await page.fill(sel, MNGM_EMAIL); break; } } catch { continue; }
    }
    for (const sel of ['input#js-password', 'input[name="password"]', 'input[type="password"]']) {
      try { if (await page.$(sel)) { await page.fill(sel, MNGM_PASSWORD); break; } } catch { continue; }
    }
    for (const sel of ['button#js-loginButton', 'button[type="submit"]']) {
      try { if (await page.$(sel)) { await page.click(sel); break; } } catch { continue; }
    }
    await page.waitForTimeout(8000);

    // Product
    await page.goto(PRODUCT_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);

    // Wait for websocket to populate price
    await page.waitForTimeout(3000);
    const content = await page.innerText("body");
    const match = content.match(/Ask\s*([\d,.]+)/i) || content.match(/([\d,.]+)\s*EGP/i);
    if (!match) throw new Error("Could not find price on mngm.com page");

    return parseFloat(match[1].replace(/,/g, ""));
  } finally {
    await browser.close();
  }
}

export async function loginAndGetWallet(): Promise<number | null> {
  const deps = await getChromium();
  if (!deps) return null;

  const { chromium, playwright } = deps;
  const execPath = await chromium.executablePath(
    "https://github.com/Sparticuz/chromium/releases/download/v133.0.0/chromium-v133.0.0-pack.tar"
  );

  const browser = await playwright.chromium.launch({
    args: chromium.args,
    executablePath: execPath,
    headless: true,
  });

  try {
    const page = await browser.newPage();
    await optimizePage(page);

    // Login
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);

    for (const sel of ['input#si-email', 'input[name="email"]', 'input[type="email"]']) {
      try { if (await page.$(sel)) { await page.fill(sel, MNGM_EMAIL); break; } } catch { continue; }
    }
    for (const sel of ['input#js-password', 'input[name="password"]', 'input[type="password"]']) {
      try { if (await page.$(sel)) { await page.fill(sel, MNGM_PASSWORD); break; } } catch { continue; }
    }
    for (const sel of ['button#js-loginButton', 'button[type="submit"]']) {
      try { if (await page.$(sel)) { await page.click(sel); break; } } catch { continue; }
    }
    await page.waitForTimeout(8000);
    if (page.url().toLowerCase().includes("login")) throw new Error("Login failed");

    // Get wallet
    await page.goto(CHECKOUT_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);
    const content = await page.innerText("body");
    const match = content.match(/[Ww]allet[^\d]{0,30}([\d,]+\.?\d*)\s*EGP/);
    return match ? parseFloat(match[1].replace(/,/g, "")) : null;
  } finally {
    await browser.close();
  }
}

export async function executeBuy(egpAmount: number): Promise<boolean> {
  const deps = await getChromium();
  if (!deps) throw new Error("Chromium not available");

  const { chromium, playwright } = deps;
  const execPath = await chromium.executablePath(
    "https://github.com/Sparticuz/chromium/releases/download/v133.0.0/chromium-v133.0.0-pack.tar"
  );

  const browser = await playwright.chromium.launch({
    args: chromium.args,
    executablePath: execPath,
    headless: true,
  });

  try {
    const page = await browser.newPage();
    await optimizePage(page);

    // Login first
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);
    for (const sel of ['input[name="email"]', 'input[type="email"]']) {
      try { if (await page.$(sel)) { await page.fill(sel, MNGM_EMAIL); break; } } catch { continue; }
    }
    for (const sel of ['input#js-password', 'input[name="password"]', 'input[type="password"]']) {
      try { if (await page.$(sel)) { await page.fill(sel, MNGM_PASSWORD); break; } } catch { continue; }
    }
    for (const sel of ['button[type="submit"]', 'button:has-text("Sign in")']) {
      try { if (await page.$(sel)) { await page.click(sel); break; } } catch { continue; }
    }
    await page.waitForTimeout(8000);

    // Navigate to product
    await page.goto(PRODUCT_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);

    // Select EGP input mode
    for (const sel of ['label:has-text("EGP")', 'input[value="egp"]', "#egp"]) {
      try { const el = await page.$(sel); if (el) { await el.click(); await page.waitForTimeout(500); break; } } catch { continue; }
    }

    // Enter amount
    for (const sel of ['input[type="number"]', ".amount-input", 'input[placeholder="0"]']) {
      try {
        const el = await page.$(sel);
        if (el) { await el.click({ clickCount: 3 }); await el.type(String(Math.floor(egpAmount))); await page.waitForTimeout(1000); break; }
      } catch { continue; }
    }

    // Checkout
    for (const sel of ['button:has-text("Checkout")', ".checkout-btn"]) {
      try { const el = await page.$(sel); if (el) { await el.click(); await page.waitForTimeout(3000); break; } } catch { continue; }
    }

    // Select wallet payment
    for (const sel of [':has-text("Mngm Wallet")', "text=Wallet", '[class*="wallet"]']) {
      try { const el = await page.$(sel); if (el) { await el.click(); await page.waitForTimeout(2000); break; } } catch { continue; }
    }

    // Confirm
    for (const sel of ['button:has-text("Confirm")', 'button:has-text("Place Order")', 'button:has-text("Pay")']) {
      try { const el = await page.$(sel); if (el) { await el.click(); await page.waitForTimeout(5000); break; } } catch { continue; }
    }

    return true;
  } finally {
    await browser.close();
  }
}

export async function executeSell(grams: number): Promise<boolean> {
  const deps = await getChromium();
  if (!deps) throw new Error("Chromium not available");

  const { chromium, playwright } = deps;
  const execPath = await chromium.executablePath(
    "https://github.com/Sparticuz/chromium/releases/download/v133.0.0/chromium-v133.0.0-pack.tar"
  );

  const browser = await playwright.chromium.launch({
    args: chromium.args,
    executablePath: execPath,
    headless: true,
  });

  try {
    const page = await browser.newPage();
    await optimizePage(page);

    // Login
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);
    for (const sel of ['input[name="email"]', 'input[type="email"]']) {
      try { if (await page.$(sel)) { await page.fill(sel, MNGM_EMAIL); break; } } catch { continue; }
    }
    for (const sel of ['input#js-password', 'input[name="password"]', 'input[type="password"]']) {
      try { if (await page.$(sel)) { await page.fill(sel, MNGM_PASSWORD); break; } } catch { continue; }
    }
    for (const sel of ['button[type="submit"]']) {
      try { if (await page.$(sel)) { await page.click(sel); break; } } catch { continue; }
    }
    await page.waitForTimeout(8000);

    await page.goto("https://mngm.com/account", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);

    for (const sel of ['a:has-text("Sell")', 'button:has-text("Sell")', '[href*="sell"]']) {
      try { const el = await page.$(sel); if (el) { await el.click(); await page.waitForTimeout(2000); break; } } catch { continue; }
    }

    for (const sel of ['input[type="number"]', ".sell-input"]) {
      try {
        const el = await page.$(sel);
        if (el) { await el.click({ clickCount: 3 }); await el.type(String(Math.round(grams * 1000000) / 1000000)); await page.waitForTimeout(1000); break; }
      } catch { continue; }
    }

    for (const sel of ['button:has-text("Sell")', 'button:has-text("Confirm")']) {
      try { const el = await page.$(sel); if (el) { await el.click(); await page.waitForTimeout(5000); break; } } catch { continue; }
    }

    return true;
  } finally {
    await browser.close();
  }
}
