import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { headers } from "next/headers";
import Script from "next/script";
import "./globals.css";
import { RefineProviders } from "./refine-providers";
import { ThemeProvider } from "@/providers/theme-provider";
import { ToastProvider } from "@/providers/toast-provider";
import { I18nProvider } from "@/providers/i18n-provider";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://app.factorylm.com";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "FactoryLM Hub",
    template: "%s · FactoryLM Hub",
  },
  description: "AI-powered industrial maintenance platform",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    siteName: "FactoryLM",
    title: "FactoryLM Hub",
    description: "AI-powered industrial maintenance platform",
    url: SITE_URL,
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "FactoryLM" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "FactoryLM Hub",
    description: "AI-powered industrial maintenance platform",
    images: ["/og-image.png"],
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? "";
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <body className="h-full antialiased bg-background text-foreground">
        {/* Unregister any legacy Open WebUI service worker still cached in user browsers.
            OWU registered at scope "/" and intercepts all requests; this clears it on first load. */}
        <Script
          id="sw-killer"
          strategy="beforeInteractive"
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `if('serviceWorker'in navigator){navigator.serviceWorker.getRegistrations().then(function(r){r.forEach(function(s){s.unregister()})});caches.keys().then(function(n){n.forEach(function(c){caches.delete(c)})})}`,
          }}
        />
        <ThemeProvider>
          <I18nProvider>
            <ToastProvider>
              <RefineProviders>{children}</RefineProviders>
            </ToastProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
