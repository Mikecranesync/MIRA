import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Create Account",
  description: "Create your FactoryLM account and get AI-powered industrial maintenance answers from cited OEM sources.",
  alternates: {
    canonical: "https://app.factorylm.com/hub/signup",
  },
};

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
