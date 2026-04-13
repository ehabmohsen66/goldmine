import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const { imageBase64 } = await req.json();

    if (!imageBase64) {
      return NextResponse.json({ error: "No image provided" }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Gemini API key is missing" }, { status: 500 });
    }

    // Clean up base64 string if it contains the data uri prefix
    const base64Data = imageBase64.replace(/^data:image\/(png|jpeg|jpg);base64,/, "");

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const prompt = `You are a financial OCR assistant. I am giving you a screenshot of my stock portfolio from the Thndr app or another Egyptian stock broker. 
Your task is to extract all the stocks I own. For each stock, extract:
1. "symbol": The stock symbol (e.g. COMI, ISPH, FAIT).
2. "buyPrice": The average buy price or cost basis (as a number).
3. "shares": The quantity / number of shares owned (as a number).

If you cannot find the EXACT symbol, try your best to guess the standard EGX symbol (e.g., CIB -> COMI). 
Return ONLY a valid JSON array of objects. No markdown formatting, no backticks, no explanations. Just the array.
Example: [{"symbol": "COMI", "buyPrice": 75.5, "shares": 1000}]`;

    const payload = {
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: "image/jpeg",
                data: base64Data,
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        response_mime_type: "application/json",
      },
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("Gemini API error:", err);
      throw new Error(`Google API returned ${res.status}: ${err}`);
    }

    const data = await res.json();
    const textOutput = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!textOutput) {
      throw new Error("No text output from Gemini");
    }

    // Parse the JSON
    let parsedPortfolio;
    try {
      parsedPortfolio = JSON.parse(textOutput.trim());
    } catch (e) {
      throw new Error("Failed to parse Gemini output as JSON: " + textOutput);
    }

    return NextResponse.json({ portfolio: parsedPortfolio });
  } catch (err) {
    console.error("Error analyzing screenshot:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
