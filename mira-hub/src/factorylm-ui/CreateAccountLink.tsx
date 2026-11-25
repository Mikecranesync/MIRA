import Link from "next/link";
export function signInLinkFailure(status: number): string {
    if (status === 409) return "New to FactoryLM? Choose Create account below to set up your workspace.";
    if (status === 503) return "Email delivery is temporarily unavailable. Please try again later or contact support@factorylm.com.";
    if (status === 429) return "Too many email requests. Please try again later.";
    return "Couldn't send the link. Try again.";
}
/** Keep returning sign-in neutral; the signup gateway owns the current offer. */
export function CreateAccountLink() {
    return <Link href="/signup" className="text-blue-400 hover:text-blue-300 font-medium">Create account</Link>;
}
