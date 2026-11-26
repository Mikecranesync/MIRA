import { createHash } from "node:crypto";
export const ONBOARDING_VERSION = "factorylm-verified-onboarding-v1";
export const ONBOARDING_SENTENCE = "I agree to the FactoryLM Terms of Service and free-access policy and Privacy Policy.";
export const ONBOARDING_SHA256 = createHash("sha256").update(ONBOARDING_SENTENCE).digest("hex");
export function onboardingPolicy() {
    const origin = new URL(process.env.MIRA_MARKETING_ORIGIN || "https://factorylm.com");
    if (origin.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && origin.protocol === "http:" && origin.hostname === "127.0.0.1"))
        throw new Error("Invalid public marketing origin");
    return { agreementVersion: ONBOARDING_VERSION, agreementSentence: ONBOARDING_SENTENCE,
        policyUrl: new URL("/free-technicians", origin).href,
        privacyUrl: new URL("/privacy", origin).href };
}
