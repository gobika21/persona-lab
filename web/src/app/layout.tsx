import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import Link from "next/link";
import Nav from "@/components/Nav";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const grotesk = Space_Grotesk({ variable: "--font-grotesk", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Persona Lab: can everyone use your website?", template: "%s: Persona Lab" },
  description: "AI agents test your website the way disabled people actually browse: keyboard only, with a screen reader, color blind, and at 200% zoom.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${grotesk.variable}`}>
      <body className="flex min-h-dvh flex-col">
        <a href="#main" className="absolute -left-[999px] top-2 z-50 rounded-lg border-2 border-edge bg-lime px-3 py-2 font-bold text-on-pop focus:left-3">
          Skip to content
        </a>
        <Nav />
        <main id="main" className="flex-1">{children}</main>
        <footer className="no-print border-t-2 border-edge pt-7 pb-12 text-[.85rem] text-ink-3">
          <div className="wrap">
            Persona Lab: AI agents that test the web the way disabled people use it. Automated agents find many, not all, barriers. Test with real users too.{" "}
            <Link href="/accessibility" className="inline-block py-0.5 font-semibold text-ink-2 underline">Accessibility statement</Link>
          </div>
        </footer>
      </body>
    </html>
  );
}
