/**
 * mngm.com scraper — runs in Vercel Serverless using @sparticuz/chromium-min + playwright-core
 */

const PRODUCT_URL = "https://mngm.com/buy/metals/product/8";
const CHECKOUT_URL = "https://mngm.com/account/checkout/digital";
const LOGIN_URL = "https://mngm.com/account/login";

const MNGM_EMAIL = process.env.MNGM_EMAIL ?? "";
const MNGM_PASSWORD = process.env.MNGM_PASSWORD ?? "";

// ─── Shared browser args (no chromium.args — it returns undefined at runtime) ──
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

async function getChromium() {
  try {
    const chromium = (await import("@sparticuz/chromium-min")).default;
    const playwright = await import("playwright-core");
    return { chromium, playwright };
  } catch {
    return null;
  }
}

async function launchBrowser() {
  const deps = await getChromium();
  if (!deps) throw new Error("Chromium not available");
  const { chromium, playwright } = deps;
  const execPath = await chromium.executablePath(
    "https://github.com/Sparticuz/chromium/releases/download/v133.0.0/chromium-v133.0.0-pack.tar"
  );
  return playwright.chromium.launch({ args: CHROMIUM_ARGS, executablePath: execPath, headless: true });
}

/** Block images/styles/fonts to save RAM */
async function optimizePage(page: any) {
  await page.route("**/*", (route: any) => {
    const t = route.request().resourceType();
    if (["image", "stylesheet", "font", "media"].includes(t)) route.abort().catch(() => {});
    else route.continue().catch(() => {});
  });
}

/** Fill a field character by character to look human */
async function humanType(page: any, selector: string, text: string) {
  if (!text) throw new Error(`humanType: text is empty for selector ${selector}`);
  await page.waitForSelector(selector, { timeout: 10000 });
  await page.click(selector);
  await page.waitForTimeout(300);
  for (const char of text) {
    await page.type(selector, char, { delay: 70 + Math.random() * 50 });
  }
}

/** Login and return { browser, page }. Caller must close the browser. */
async function launchAndLogin() {
  if (!MNGM_EMAIL || !MNGM_PASSWORD) {
    throw new Error("MNGM_EMAIL or MNGM_PASSWORD env vars are not set");
  }

  const browser = await launchBrowser();
  const page = await browser.newPage();
  await optimizePage(page);

  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

  await humanType(page, "#si-email", MNGM_EMAIL);
  await page.waitForTimeout(500);
  await humanType(page, "#js-password", MNGM_PASSWORD);
  await page.waitForTimeout(800);
  await page.click("#js-loginButton");
  await page.waitForTimeout(8000);

  const url = page.url().toLowerCase();
  if (url.includes("/login") || url.includes("/signin")) {
    await browser.close();
    throw new Error("Login failed — check MNGM_EMAIL / MNGM_PASSWORD in Vercel env vars");
  }

  return { browser, page };
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

/** Scrape price WITHOUT login — the product page is publicly accessible */
export async function getGoldPrice(): Promise<number> {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await optimizePage(page);

    await page.goto(PRODUCT_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(4000); // let websocket populate price

    const content = await page.innerText("body");
    const match =
      content.match(/Ask[\s:]*([0-9][0-9,]+\.?[0-9]*)/i) ||
      content.match(/([0-9][0-9,]+\.[0-9]+)\s*EGP/i) ||
      content.match(/([0-9][0-9,]+)\s*EGP/i);

    if (!match) throw new Error("Could not find price on mngm.com page");
    return parseFloat(match[1].replace(/,/g, ""));
  } finally {
    await browser.close();
  }
}

/** Get wallet balance — requires login */
export async function loginAndGetWallet(): Promise<number | null> {
  try {
    const { browser, page } = await launchAndLogin();
    try {
      await page.goto(CHECKOUT_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(3000);
      const content = await page.innerText("body");
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

/** Buy fractional gold — requires login */
export async function executeBuy(egpAmount: number): Promise<boolean> {
  const { browser, page } = await launchAndLogin();
  try {
    await page.goto(PRODUCT_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);

    for (const sel of ['label:has-text("EGP")', 'input[value="egp"]', "#egp"]) {
      try { const el = await page.$(sel); if (el) { await el.click(); await page.waitForTimeout(500); break; } } catch { continue; }
    }

    for (const sel of ['input[type="number"]', ".amount-input", 'input[placeholder="0"]']) {
      try {
        const el = await page.$(sel);
        if (el) { await el.click({ clickCount: 3 }); await el.type(String(Math.floor(egpAmount))); await page.waitForTimeout(1000); break; }
      } catch { continue; }
    }

    for (const sel of ['button:has-text("Checkout")', ".checkout-btn"]) {
      try { const el = await page.$(sel); if (el) { await el.click(); await page.waitForTimeout(3000); break; } } catch { continue; }
    }

    for (const sel of [':has-text("Mngm Wallet")', "text=Wallet", '[class*="wallet"]']) {
      try { const el = await page.$(sel); if (el) { await el.click(); await page.waitForTimeout(2000); break; } } catch { continue; }
    }

    for (const sel of ['button:has-text("Confirm")', 'button:has-text("Place Order")', 'button:has-text("Pay")']) {
      try { const el = await page.$(sel); if (el) { await el.click(); await page.waitForTimeout(5000); break; } } catch { continue; }
    }

    return true;
  } finally {
    await browser.close();
  }
}

/** Sell gold — requires login */
export async function executeSell(grams: number): Promise<boolean> {
  const { browser, page } = await launchAndLogin();
  try {
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
