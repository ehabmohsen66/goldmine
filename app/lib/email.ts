import nodemailer from "nodemailer";

const SMTP_HOST = process.env.SMTP_HOST ?? "smtp.gmail.com";
const SMTP_PORT = parseInt(process.env.SMTP_PORT ?? "587");
const SMTP_USER = process.env.SMTP_USER ?? "";
const SMTP_PASS = process.env.SMTP_PASS ?? "";
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL ?? "";
const SELL_TARGET_PCT = parseFloat(process.env.SELL_TARGET_PCT ?? "0.7");

function createTransport() {
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: false,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

async function sendEmail(subject: string, html: string) {
  if (!SMTP_PASS) return;
  try {
    const transport = createTransport();
    await transport.sendMail({
      from: SMTP_USER,
      to: NOTIFY_EMAIL,
      subject,
      html,
    });
  } catch (e) {
    console.error("Email failed:", e);
  }
}

export async function emailBought(
  price: number, grams: number, egp: number, tradeNum: number
) {
  await sendEmail(
    `🟢 GOLDMINE BOUGHT — ${grams.toFixed(4)}g @ ${price.toLocaleString()} EGP/g`,
    `<div style="font-family:sans-serif;max-width:500px">
      <h2 style="color:#CA8A04">Gold Purchased — Trade #${tradeNum}</h2>
      <table style="border-collapse:collapse;font-size:15px;width:100%">
        <tr><td style="padding:8px;color:#888">Price</td><td><b>${price.toLocaleString()} EGP/gram</b></td></tr>
        <tr><td style="padding:8px;color:#888">Spent</td><td><b>${egp.toLocaleString()} EGP</b></td></tr>
        <tr><td style="padding:8px;color:#888">Gold acquired</td><td><b>${grams.toFixed(6)} grams</b></td></tr>
        <tr><td style="padding:8px;color:#888">Will sell at</td><td><b>${(price * (1 + SELL_TARGET_PCT / 100)).toLocaleString()} EGP/gram (+${SELL_TARGET_PCT}%)</b></td></tr>
      </table>
    </div>`
  );
}

export async function emailSold(
  buyPrice: number, sellPrice: number, grams: number,
  profit: number, balance: number, tradeCount: number, totalProfit: number
) {
  await sendEmail(
    `💰 GOLDMINE SOLD — Profit: +${profit.toLocaleString()} EGP | Total: +${totalProfit.toLocaleString()} EGP`,
    `<div style="font-family:sans-serif;max-width:500px">
      <h2 style="color:#16a34a">Trade #${tradeCount} Complete</h2>
      <table style="border-collapse:collapse;font-size:15px;width:100%">
        <tr><td style="padding:8px;color:#888">Bought at</td><td>${buyPrice.toLocaleString()} EGP/gram</td></tr>
        <tr><td style="padding:8px;color:#888">Sold at</td><td><b>${sellPrice.toLocaleString()} EGP/gram</b></td></tr>
        <tr><td style="padding:8px;color:#888">Grams</td><td>${grams.toFixed(6)} g</td></tr>
        <tr><td style="padding:8px;color:#888">Profit this trade</td><td style="color:#16a34a"><b>+${profit.toLocaleString()} EGP</b></td></tr>
        <tr><td style="padding:8px;color:#888">All-time profit</td><td style="color:#16a34a"><b>+${totalProfit.toLocaleString()} EGP</b></td></tr>
        <tr><td style="padding:8px;color:#888">Wallet balance</td><td><b>${balance.toLocaleString()} EGP</b></td></tr>
      </table>
    </div>`
  );
}

export async function emailAddFunds(
  price: number, wallet: number, dipPct: number, peak: number
) {
  await sendEmail(
    `💰 ADD FUNDS — Gold dipped ${dipPct.toFixed(1)}% — great buy opportunity!`,
    `<div style="font-family:sans-serif;max-width:500px">
      <h2 style="color:#CA8A04">Buying Opportunity — Wallet Too Low</h2>
      <p style="color:#555">Gold dropped ${dipPct.toFixed(2)}% but your wallet doesn't have enough. Top up now.</p>
      <table style="border-collapse:collapse;font-size:15px;width:100%">
        <tr><td style="padding:8px;color:#888">Recent peak</td><td>${peak.toLocaleString()} EGP/gram</td></tr>
        <tr><td style="padding:8px;color:#888">Current price</td><td><b>${price.toLocaleString()} EGP/gram</b></td></tr>
        <tr><td style="padding:8px;color:#888">Drop</td><td style="color:#CA8A04"><b>${dipPct.toFixed(2)}% below peak</b></td></tr>
        <tr><td style="padding:8px;color:#888">Your wallet</td><td style="color:#dc2626">${wallet.toLocaleString()} EGP</td></tr>
      </table>
      <p style="margin-top:16px"><a href="https://mngm.com/account" style="background:#CA8A04;color:#000;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">Top up mngm Wallet →</a></p>
    </div>`
  );
}

export async function emailHoldingUpdate(
  buyPrice: number, currentPrice: number, grams: number, changePct: number
) {
  await sendEmail(
    `📊 GOLDMINE HOLDING — Down ${Math.abs(changePct).toFixed(1)}% — patient, no stop-loss`,
    `<div style="font-family:sans-serif;max-width:500px">
      <h2 style="color:#d97706">Holding Position — Waiting for Recovery</h2>
      <p style="color:#555">Gold is below your buy price. Holding as instructed.</p>
      <table style="border-collapse:collapse;font-size:15px;width:100%">
        <tr><td style="padding:8px;color:#888">Buy price</td><td>${buyPrice.toLocaleString()} EGP/gram</td></tr>
        <tr><td style="padding:8px;color:#888">Current price</td><td>${currentPrice.toLocaleString()} EGP/gram</td></tr>
        <tr><td style="padding:8px;color:#888">P/L</td><td style="color:#dc2626">${changePct.toFixed(2)}%</td></tr>
        <tr><td style="padding:8px;color:#888">Gold held</td><td>${grams.toFixed(6)} grams</td></tr>
      </table>
    </div>`
  );
}

export async function emailError(errorMsg: string) {
  await sendEmail(
    "🚨 GOLDMINE BOT STOPPED — Error needs attention",
    `<div style="font-family:sans-serif;max-width:500px">
      <h2 style="color:#dc2626">Bot Error</h2>
      <pre style="font-family:monospace;font-size:12px;background:#f3f4f6;padding:16px;border-radius:8px;overflow:auto">${errorMsg}</pre>
    </div>`
  );
}
