import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MLB 3D — Live Games in a Low-Poly Ballpark",
  description:
    "Pick a live MLB game and watch it unfold in a low-poly 3D ballpark, driven by the MLB Stats API.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-[#0a0f18] text-white">{children}</body>
    </html>
  );
}
