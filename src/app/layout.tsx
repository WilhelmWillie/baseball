import type { Metadata } from "next";
import { Baloo_2, Nunito } from "next/font/google";
import "./globals.css";

// Baloo carries the wordmark and every number on the scorebug; Nunito reads
// small and round for everything else.
const baloo = Baloo_2({
  subsets: ["latin"],
  variable: "--font-baloo",
  display: "swap",
});

const nunito = Nunito({
  subsets: ["latin"],
  variable: "--font-nunito",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Ballpark — Watch Baseball Come to Life",
  description:
    "Pick a game. Grab a seat. Watch every pitch, hit, and baserunner unfold in a charming low-poly ballpark.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`h-full antialiased ${baloo.variable} ${nunito.variable}`}>
      <body className="flex min-h-full flex-col bg-paper text-bark">{children}</body>
    </html>
  );
}
