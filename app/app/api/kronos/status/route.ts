import { NextResponse } from "next/server";
import { getKronosForecast } from "@/lib/redis";

export const runtime = "nodejs";

export async function GET() {
  const forecast = await getKronosForecast();
  return NextResponse.json({
    engineOnline: forecast?.engineOnline ?? false,
    hasData: !!forecast,
    forecast,
    kronosApiConfigured: !!process.env.KRONOS_API_URL,
  });
}
