import type { Metadata } from "next";
import { Instrument_Sans, Unbounded } from "next/font/google";
import type { ReactNode } from "react";
import "@workspace/ui/globals.css";
import { requestProduct } from "@/lib/session/server";
import { PRODUCTS } from "@/products";
import { Providers } from "./providers";

const sans = Instrument_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-instrument" });
const display = Unbounded({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-unbounded" });

/** Titles follow the host's product, so the HR host reads "HR Suite" in the browser tab. */
export async function generateMetadata(): Promise<Metadata> {
  const { name } = PRODUCTS[await requestProduct()];
  return {
    title: { default: name, template: `%s | ${name}` },
    description: "Operations platform demo for US flooring businesses.",
  };
}

/** Root HTML frame: fonts from the design brief and the app-wide providers. */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${display.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
