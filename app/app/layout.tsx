import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Goldmine — Autonomous Gold Trading Bot",
  description: "24/7 automated gold trading dashboard for mngm.com. Monitor positions, track profits, and control your bot.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
