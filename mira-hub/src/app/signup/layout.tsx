import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Apply for a free MIRA pilot",
  description: "Apply for one of five free, scoped 30-day MIRA pilots. Manual approval before onboarding; waiting uses no pilot days. Paid continuation agreed separately.",
  alternates: {
    canonical: "https://app.factorylm.com/signup/",
  },
};

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
