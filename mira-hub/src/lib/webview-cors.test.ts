import { describe, it, expect } from "vitest";
import {
  isWebviewCorsPath,
  matchWebviewOrigin,
  parseWebviewOrigins,
  webviewCorsHeaders,
  webviewPreflightHeaders,
} from "./webview-cors";

describe("webview-cors — allowlist parsing (#3453)", () => {
  it("empty / unset → no origins (flag off)", () => {
    expect(parseWebviewOrigins(undefined)).toEqual([]);
    expect(parseWebviewOrigins("")).toEqual([]);
    expect(parseWebviewOrigins(" , ")).toEqual([]);
  });

  it("accepts exact Android + iOS WebView origins, lowercased + de-duped", () => {
    expect(
      parseWebviewOrigins(" https://localhost, capacitor://localhost ,HTTPS://LOCALHOST"),
    ).toEqual(["https://localhost", "capacitor://localhost"]);
  });

  it("never accepts a wildcard, a bare scheme, a path, or plain http", () => {
    expect(parseWebviewOrigins("*")).toEqual([]);
    expect(parseWebviewOrigins("https://*")).toEqual([]);
    expect(parseWebviewOrigins("https://")).toEqual([]);
    expect(parseWebviewOrigins("https://localhost/")).toEqual([]);
    expect(parseWebviewOrigins("http://localhost")).toEqual([]);
    expect(parseWebviewOrigins("https://user@localhost")).toEqual([]);
  });

  it("keeps an explicit port", () => {
    expect(parseWebviewOrigins("https://localhost:8443")).toEqual(["https://localhost:8443"]);
  });
});

describe("webview-cors — origin matching", () => {
  const allow = ["https://localhost"];
  it("returns the matched origin only on an exact match", () => {
    expect(matchWebviewOrigin("https://localhost", allow)).toBe("https://localhost");
    expect(matchWebviewOrigin("HTTPS://localhost", allow)).toBe("https://localhost");
    expect(matchWebviewOrigin("https://localhost.evil.com", allow)).toBeNull();
    expect(matchWebviewOrigin("https://evil.com", allow)).toBeNull();
    expect(matchWebviewOrigin(null, allow)).toBeNull();
    expect(matchWebviewOrigin("https://localhost", [])).toBeNull();
  });
});

describe("webview-cors — headers", () => {
  it("echoes the origin (never *) with credentials and Vary", () => {
    expect(webviewCorsHeaders("https://localhost")).toEqual({
      "Access-Control-Allow-Origin": "https://localhost",
      "Access-Control-Allow-Credentials": "true",
      Vary: "Origin",
    });
  });

  it("preflight echoes the requested headers and lists the notebook methods", () => {
    const h = webviewPreflightHeaders("https://localhost", "content-type, x-requested-with");
    expect(h["Access-Control-Allow-Origin"]).toBe("https://localhost");
    expect(h["Access-Control-Allow-Credentials"]).toBe("true");
    expect(h["Access-Control-Allow-Headers"]).toBe("content-type, x-requested-with");
    expect(h["Access-Control-Allow-Methods"]).toContain("POST");
    expect(h["Access-Control-Allow-Methods"]).toContain("DELETE");
    expect(webviewPreflightHeaders("https://localhost", null)["Access-Control-Allow-Headers"]).toBe(
      "Content-Type",
    );
  });
});

describe("webview-cors — path scope", () => {
  it("only the equipment-notebook routes", () => {
    expect(isWebviewCorsPath("/api/equipment-notebooks/")).toBe(true);
    expect(isWebviewCorsPath("/api/equipment-notebooks/abc/chat/")).toBe(true);
    expect(isWebviewCorsPath("/api/equipment-notebooks/abc/sources/x/passage/")).toBe(true);
    expect(isWebviewCorsPath("/api/assets/")).toBe(false);
    expect(isWebviewCorsPath("/api/files/")).toBe(false);
    expect(isWebviewCorsPath("/equipment/")).toBe(false);
  });
});
