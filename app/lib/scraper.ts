/**
 * mngm.com scraper — runs in Vercel Serverless using @sparticuz/chromium-min + playwright-core
 */

const PRODUCT_URL = "https://mngm.com/buy/metals/product/8";
const MY_MNGM_URL = "https://mngm.com/account/my-mngm";
const LOGIN_URL = "https://mngm.com/account/login";

const MNGM_EMAIL = process.env.MNGM_EMAIL ?? "";
const MNGM_PASSWORD = process.env.MNGM_PASSWORD ?? "";

// ─── Chromium args tuned for Vercel serverless (fork() is blocked) ───────────
const CHROMIUM_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--no-first-run",
  "--no-zygote",
  "--single-process",           // required in Vercel: fork() is blocked
  "--disable-extensions",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-ipc-flooding-protection",
  "--disable-hang-monitor",
  "--disable-breakpad",
  "--disable-translate",
  "--mute-audio",
  "--use-gl=swiftshader",
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
  const { chromium } = await import("playwright-core");

  // ── Railway / persistent server: PLAYWRIGHT_BROWSERS_PATH is set → use playwright's Chromium ──
  if (process.env.PLAYWRIGHT_BROWSERS_PATH || process.env.CHROMIUM_PATH) {
    const executablePath = process.env.CHROMIUM_PATH ?? chromium.executablePath();
    console.log(`[scraper] Launching Chromium from: ${executablePath}`);
    return chromium.launch({ executablePath, args: CHROMIUM_ARGS, headless: true });
  }

  // ── Vercel / Lambda: use sparticuz chromium-min ────────────────────────────
  const sparticuz = (await import("@sparticuz/chromium-min")).default;
  const execPath = await sparticuz.executablePath(
    "https://github.com/Sparticuz/chromium/releases/download/v133.0.0/chromium-v133.0.0-pack.tar"
  );
  return chromium.launch({ args: CHROMIUM_ARGS, executablePath: execPath, headless: true });
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

/** Get live gold price — tries fast WebSocket feed first, falls back to browser */
export async function getGoldPrice(): Promise<number> {
  // ── Fast path: SignalR WebSocket (~200ms) ─────────────────────────────────
  try {
    const { getPriceFromFeed } = await import("./feed");
    const feedPrice = await getPriceFromFeed(8000);
    if (feedPrice && feedPrice > 1000) return feedPrice; // sanity check: EGP gold > 1000
  } catch { /* fall through to browser */ }

  // ── Slow path: browser scrape (~15s) ─────────────────────────────────────
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await optimizePage(page);

    await page.goto(PRODUCT_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(4000);

    const content = await page.innerText("body");
    const match =
      content.match(/Ask[\s:]*([\d,]+\.?\d*)/i) ||
      content.match(/([\d,]+\.\d+)\s*EGP/i) ||
      content.match(/([\d,]+)\s*EGP/i);

    if (!match) throw new Error("Could not find price on mngm.com page");
    return parseFloat(match[1].replace(/,/g, ""));
  } finally {
    await browser.close();
  }
}


/** Get wallet balance and position data from /account/my-mngm — requires login */
export async function loginAndGetWallet(): Promise<number | null> {
  try {
    const { browser, page } = await launchAndLogin();
    try {
      await page.goto(MY_MNGM_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(3000);
      const content = await page.innerText("body");

      // Match "Cash Balance" section: "Available: 0.32"
      const cashMatch =
        content.match(/Cash\s*Balance[^\d]{0,60}Available[:\s]+([\d,]+\.?\d*)/i) ||
        content.match(/Available[:\s]+([\d,]+\.?\d*)\s*(?:EGP)?/i);

      return cashMatch ? parseFloat(cashMatch[1].replace(/,/g, "")) : null;
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
    // ── Step 1: Navigate to fractional buy page ───────────────────────────────
    await page.goto("https://mngm.com/buy/metals/fractional/8", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(2000);

    // ── Step 2: Fill EGP amount using React-compatible method ────────────────
    const amountInput = await page.$('input[type="text"], input[type="number"]');
    if (amountInput) {
      await amountInput.click({ clickCount: 3 });
      await amountInput.fill(String(Math.floor(egpAmount)));        // React-compatible fill
      await amountInput.dispatchEvent("input");                     // trigger React onChange
      await amountInput.dispatchEvent("change");
    }
    await page.waitForTimeout(2000); // wait for React to re-render and enable Checkout

    // ── Step 3: Wait for Checkout to be enabled then click ────────────────────
    await page.waitForSelector('text=Checkout:not([disabled])', { timeout: 15000 }).catch(() => {});
    await page.click('text=Checkout');
    await page.waitForTimeout(4000);

    // ── Step 4: On checkout/digital — click "Wallet" card ────────────────────
    // The card shows "Wallet / Pay with your Mngm Wallet"
    for (const sel of [
      ':has-text("Pay with your Mngm Wallet")',
      ':has-text("Mngm Wallet")',
      'text=Wallet',
    ]) {
      try {
        const el = await page.$(sel);
        if (el) { await el.click(); await page.waitForTimeout(2000); break; }
      } catch { continue; }
    }

    // ── Step 5: Click the "Wallet" icon/button to confirm payment ─────────────
    for (const sel of [
      '.payment-icon',
      'img[alt*="wallet" i]',
      ':has-text("Wallet"):visible',
    ]) {
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
