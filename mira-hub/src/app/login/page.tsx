import type { Metadata } from "next";
import LoginForm from "./login-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to FactoryLM Hub.",
  alternates: { canonical: "/login" },
  openGraph: {
    title: "Sign in · FactoryLM",
    description: "Sign in to FactoryLM Hub.",
    url: "/login",
    type: "website",
    images: ["https://factorylm.com/og-image.png"],
  },
  robots: { index: true, follow: true },
};

export default function LoginPage() {
  return <LoginForm />;
}
