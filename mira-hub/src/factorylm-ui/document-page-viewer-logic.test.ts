import { describe, expect, it } from "vitest";
import { API_BASE } from "@/lib/config";
import {
  failureMessage,
  filenameFromDisposition,
  isPdf,
  nativeFileHref,
  pageCaption,
  pageToShow,
  parseViewerRequest,
  viewerHref,
  viewerMode,
} from "./document-page-viewer-logic";

// #5333: a phone citation must open the right source at the right page.
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "/hub";
const FILE = "3a0f78a2-1111-4222-8333-944445555666";

describe("viewerHref and parseViewerRequest round-trip the file and the cited page", () => {
  it("carries file and page", () => {
    const href = viewerHref(FILE, 47);
    expect(href).toBe(`${BASE_PATH}/v3/source/?file=${FILE}&page=47`);
    expect(parseViewerRequest(href.slice(href.indexOf("?")))).toEqual({ fileId: FILE, page: 47 });
  });
  it("no page, no page parameter", () => {
    expect(viewerHref(FILE, null)).toBe(`${BASE_PATH}/v3/source/?file=${FILE}`);
    expect(parseViewerRequest(`?file=${FILE}`)).toEqual({ fileId: FILE, page: null });
  });
  it("encodes an odd id instead of letting it break the query", () => {
    expect(parseViewerRequest(viewerHref("a&page=9", 2).split("?")[1])).toEqual({ fileId: "a&page=9", page: 2 });
  });
  it("a bad page is no page, never a wrong page", () => {
    for (const p of ["0", "-3", "2.5", "x", "", "9999999999999999999"]) {
      expect(parseViewerRequest(`?file=${FILE}&page=${p}`)?.page).toBeNull();
    }
  });
  it("control: missing file is no request", () => {
    expect(parseViewerRequest("?page=4")).toBeNull();
    expect(parseViewerRequest("")).toBeNull();
  });
});

describe("viewerMode: platform viewer first, drawn page only where there is none", () => {
  it("desktop with a PDF viewer gets the file itself", () => {
    expect(viewerMode(true)).toBe("native");
  });
  it("Android Chrome (false) and browsers without the flag draw the page", () => {
    expect(viewerMode(false)).toBe("render");
    expect(viewerMode(undefined)).toBe("render");
  });
});

describe("nativeFileHref is the byte route, at the page for a native viewer", () => {
  it("with and without a page", () => {
    expect(nativeFileHref(FILE, 47)).toBe(`${API_BASE}/api/namespace/files/${FILE}/#page=47`);
    expect(nativeFileHref(FILE, null)).toBe(`${API_BASE}/api/namespace/files/${FILE}/`);
  });
});

describe("pageToShow", () => {
  it("shows the cited page when the file has it", () => {
    expect(pageToShow(47, 312)).toEqual({ page: 47, outOfRange: false });
    expect(pageToShow(312, 312)).toEqual({ page: 312, outOfRange: false });
  });
  it("says so instead of silently showing another page when the cited page is missing", () => {
    expect(pageToShow(313, 312)).toEqual({ page: 1, outOfRange: true });
  });
  it("no cited page starts at page 1", () => {
    expect(pageToShow(null, 312)).toEqual({ page: 1, outOfRange: false });
  });
});

describe("filenameFromDisposition reads the file route's header", () => {
  it("decodes the route's percent-encoded name", () => {
    expect(filenameFromDisposition('inline; filename="GS10 manual %E2%80%93 rev B.pdf"')).toBe("GS10 manual – rev B.pdf");
  });
  it("prefers filename*", () => {
    expect(filenameFromDisposition("inline; filename=\"x.pdf\"; filename*=UTF-8''Gr%C3%BCn.pdf")).toBe("Grün.pdf");
  });
  it("control: no header, no name", () => {
    expect(filenameFromDisposition(null)).toBeNull();
    expect(filenameFromDisposition("inline")).toBeNull();
  });
});

describe("isPdf", () => {
  it("accepts PDF only", () => {
    expect(isPdf("application/pdf")).toBe(true);
    expect(isPdf("application/pdf; charset=binary")).toBe(true);
    expect(isPdf("image/jpeg")).toBe(false);
    expect(isPdf(null)).toBe(false);
  });
});

describe("failureMessage and pageCaption say exactly what happened", () => {
  it("a fresh sign-in case is named, not shown as a blank page", () => {
    expect(failureMessage(401)).toMatch(/signed out/i);
    expect(failureMessage(404)).toMatch(/no longer/i);
    expect(failureMessage(500)).toMatch(/Open document/);
  });
  it("names source, page and revision", () => {
    expect(pageCaption("GS10 manual.pdf", 47, 312, FILE)).toBe("GS10 manual.pdf · page 47 of 312 · file 3a0f78a2");
  });
});
