import { generateForecast } from "./app/api/egx/forecast/route";

async function run() {
  console.log("Testing forecast for COMI...");
  try {
    const res = await generateForecast("COMI");
    console.log("Success:", res.ok);
  } catch (err) {
    console.error("Error:", err);
  }
}

run();
