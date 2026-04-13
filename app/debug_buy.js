const { chromium } = require('playwright-core');
require('dotenv').config({ path: '.env.local' }); // Or whatever env has the credentials

(async () => {
  // Use Sparticuz or local playwright
  const browser = await chromium.launch({
    headless: true
  }).catch(async () => {
    const playwright = await import("playwright");
    return playwright.chromium.launch({ headless: true });
  }).catch(async () => {
     // fallback 2: try local chrome
     return chromium.launch({ channel: 'chrome', headless: true });
  });

  const page = await browser.newPage();
  
  // Login
  await page.goto("https://mngm.com/account/login", { waitUntil: "domcontentloaded" });
  await page.fill("#si-email", 'ehabmohsen66@gmail.com');
  await page.fill("#js-password", 'TEData123$%');
  await page.click("#js-loginButton");
  await page.waitForTimeout(5000);
  
  // Go to buy fractional
  await page.goto("https://mngm.com/buy/metals/fractional/8", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  
  // Take screenshot before
  await page.screenshot({ path: '/Users/ihabmohamed/goldmine/app/debug_before.png' });
  
  // Find amount input
  const amountInput = await page.$('input[type="text"], input[type="number"]');
  if (amountInput) {
    await amountInput.click({clickCount: 3});
    await amountInput.fill('50');
    await amountInput.dispatchEvent("input");
    await amountInput.dispatchEvent("change");
  }
  
  await page.waitForTimeout(2000);
  
  // Take screenshot after
  await page.screenshot({ path: '/Users/ihabmohamed/goldmine/app/debug_after.png' });
  
  console.log("Screenshots saved locally");
  await browser.close();
})();
