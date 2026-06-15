// Vitest coverage for the client-side auth validation helpers (#1957).
//
// Run: cd mira-hub && npx vitest run src/lib/auth-validation
//
// These back the inline field errors that replaced the browser-native
// validation popups on the login / signup forms.

import { describe, it, expect } from "vitest";
import {
  MIN_PASSWORD_LENGTH,
  isValidEmail,
  emailError,
  passwordError,
} from "@/lib/auth-validation";

describe("isValidEmail", () => {
  it("accepts well-formed addresses", () => {
    expect(isValidEmail("tech@factory.com")).toBe(true);
    expect(isValidEmail("a.b+c@sub.example.co")).toBe(true);
    expect(isValidEmail("  trim@me.io  ")).toBe(true);
  });

  it("rejects addresses missing an '@', domain, or TLD", () => {
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("missing@tld")).toBe(false);
    expect(isValidEmail("@no-local.com")).toBe(false);
    expect(isValidEmail("two@@at.com")).toBe(false);
    expect(isValidEmail("spaces in@email.com")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });
});

describe("emailError", () => {
  it("prompts when empty", () => {
    expect(emailError("")).toBe("Enter your work email.");
    expect(emailError("   ")).toBe("Enter your work email.");
  });

  it("flags invalid format", () => {
    expect(emailError("not-an-email")).toBe("Enter a valid work email.");
  });

  it("returns null when valid", () => {
    expect(emailError("tech@factory.com")).toBeNull();
  });
});

describe("passwordError", () => {
  it("flags short passwords", () => {
    expect(passwordError("short")).toBe(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
    expect(passwordError("1234567")).not.toBeNull();
  });

  it("returns null at or above the minimum length", () => {
    expect(passwordError("12345678")).toBeNull();
    expect(passwordError("a-long-enough-password")).toBeNull();
  });
});
