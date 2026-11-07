import type { Metadata } from "next";
import "@workspace/ui/globals.css";

export const metadata: Metadata = { title: "Flooring Suite demo" };

/** Root layout. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
