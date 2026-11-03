// #5132: the proof quote on [1] showed the surge-suppressor (MOV) table, not the
// sinking/sourcing sentence the answer cites. Two causes, both pinned here on the real
// page-28 chunks: the answer's "24V DC" matched the "24…48V DC" MOV row as a range
// endpoint, and the page quote came from whichever chunk was retrieved first.
import { describe, expect, it } from "vitest";
import fx from "./fixtures/5132-page28-chunks.json";
import { supportingQuote, withSupportingQuotes } from "../supporting-quote";
import { pageCitationQuote } from "../page-citation-quote";
import { relevantQuoteWindow } from "@/lib/quote-window";

const ORDERS = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];
const flat = (s: string | null) => (s ?? "").replace(/\s+/g, " ");
const SINKING = "4…7 can only be wired as sinking";

describe("#5132 page-28 citation quote", () => {
  it("fixture precondition: one chunk is the MOV table and two hold the sinking sentence", () => {
    expect(fx.chunks).toHaveLength(3);
    expect(fx.chunks.filter((c) => flat(c.content).includes(SINKING))).toHaveLength(2);
    expect(fx.chunks.some((c) => c.content.includes("24…48V DC 199-FSMA9 MOV"))).toBe(true);
  });

  it.each(ORDERS.map((o) => [o]))("a single claimed value never takes an unrelated range row as proof (order %j)", (order: number[]) => {
    const chunks = order.map((i) => fx.chunks[i].content);
    const r = supportingQuote(chunks, fx.answer, "1", fx.question);
    expect(flat(r.quote)).not.toContain("MOV");
    expect(r.quote).toBeNull();
    expect(r.unsupported).toContain("24V DC");
  });

  it.each(ORDERS.map((o) => [o]))("the page quote comes from the chunk that answers the question (order %j)", (order: number[]) => {
    const quote = pageCitationQuote(order.map((i) => fx.chunks[i].content), fx.question);
    expect(flat(quote)).toContain(SINKING);
    expect(quote).not.toContain("MOV");
  });

  it.each(ORDERS.map((o) => [o]))("end to end, the emitted [1] quote is the sinking sentence (order %j)", (order: number[]) => {
    const pageChunks = order.map((i) => ({ content: fx.chunks[i].content, sourceUrl: "doc-a", sourcePage: 28 }));
    const citations = [{ citationId: "1", quote: pageCitationQuote(pageChunks.map((c) => c.content), fx.question) }];
    const out = withSupportingQuotes(citations, pageChunks, fx.answer, fx.question);
    expect(flat(out.citations[0].quote)).toContain(SINKING);
    expect(out.citations[0].quote).not.toContain("MOV");
  });
});

describe("#5132 controls", () => {
  it("a range endpoint still proves a value when the window shares the claim's words", () => {
    const r = supportingQuote(["Supply voltage range: 12…24V DC at the terminal block."], "The supply voltage can be 24V DC [1].", "1", "what supply voltage");
    expect(r.quote).toContain("12…24V DC");
    expect(r.support).toBe("claim");
  });

  it("an exact value match needs no shared words", () => {
    const r = supportingQuote(["Rated 24V DC."], "Use 24V DC [1].", "1", "what voltage");
    expect(r.quote).toContain("24V DC");
    expect(r.support).toBe("claim");
  });

  it("a single-chunk page keeps the question-centred window", () => {
    const c = fx.chunks[1].content;
    expect(pageCitationQuote([c], fx.question)).toBe(relevantQuoteWindow(c, fx.question));
  });

  it("a tie goes to the first chunk", () => {
    const a = "Wire the sinking inputs first.";
    const b = "Wire the sinking inputs last.";
    expect(pageCitationQuote([a, b], "sinking inputs")).toBe(relevantQuoteWindow(a, "sinking inputs"));
    expect(pageCitationQuote([b, a], "sinking inputs")).toBe(relevantQuoteWindow(b, "sinking inputs"));
  });

  it("no question overlap anywhere keeps the first chunk's window", () => {
    expect(pageCitationQuote(["alpha beta", "gamma delta"], "zzz")).toBe(relevantQuoteWindow("alpha beta", "zzz"));
  });
});
