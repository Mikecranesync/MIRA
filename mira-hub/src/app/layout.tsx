import type { Metadata } from "next";
import { Inter } from "next/font/google";
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

export const metadata: Metadata = {
  title: "FactoryLM Hub",
  description: "AI-powered industrial maintenance platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <body className="h-full antialiased bg-background text-foreground">
        {/* Unregister any legacy Open WebUI service worker still cached in user browsers.
            OWU registered at scope "/" and intercepts all requests; this clears it on first load. */}
        <Script
          id="sw-killer"
          strategy="beforeInteractive"
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
