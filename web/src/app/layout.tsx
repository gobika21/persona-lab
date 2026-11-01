import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Nav from "@/components/Nav";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Persona Lab: can everyone use your website?", template: "%s: Persona Lab" },
  description: "AI agents test your website the way disabled people actually browse: keyboard only, with a screen reader, color blind, and at 200% zoom.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="flex min-h-dvh flex-col">
        <a href="#main" className="absolute -left-[999px] top-2 z-50 rounded-lg bg-ink px-3 py-2 text-bg focus:left-3">
          Skip to content
        </a>
        <Nav />
        <main id="main" className="flex-1">{children}</main>
        <footer className="no-print border-t border-line pt-7 pb-12 text-[.85rem] text-ink-3">
          <div className="wrap">
            Persona Lab: AI agents that test the web the way disabled people use it. Automated agents find many, not all, barriers. Test with real users too.
          </div>
        </footer>
      </body>
    </html>
  );
}
