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

const title = "Pocket Ballpark — Watch Baseball Come to Life";
const description =
  "Pick a game. Grab a seat. Watch every pitch, hit, and baserunner unfold in a charming low-poly ballpark.";

/**
 * Share cards need absolute URLs, and only the deployment knows what host it
 * is on. Set NEXT_PUBLIC_SITE_URL to pin it; Vercel fills its own in.
 */
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  // The og:image itself comes from the opengraph-image routes next to the
  // pages; these only supply the text around it.
  openGraph: {
    title,
    description,
    siteName: "Pocket Ballpark",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`h-full antialiased ${baloo.variable} ${nunito.variable}`}>
      <body className="flex min-h-full flex-col bg-paper text-bark">{children}</body>
    </html>
  );
}
