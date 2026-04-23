import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { RefineProviders } from "./refine-providers";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "FactoryLM Hub",
  description: "AI-powered industrial maintenance platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <body className="h-full antialiased bg-background text-foreground">
        <RefineProviders>{children}</RefineProviders>
      </body>
    </html>
  );
}
