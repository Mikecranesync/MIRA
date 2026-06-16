import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign In",
  description: "Sign in to FactoryLM — AI-powered industrial maintenance platform.",
  openGraph: {
    images: ["https://factorylm.com/og-image.png"],
  },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
