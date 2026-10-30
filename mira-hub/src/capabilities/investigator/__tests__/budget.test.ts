import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { FileSpendLedger, worstCaseUsd } from "../budget";
import { DEFAULT_PRICE_PER_MTOK_IN, DEFAULT_PRICE_PER_MTOK_OUT } from "@/capabilities/openai-run-budget";

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "investigator-ledger-"));
  file = path.join(dir, "spend-ledger.jsonl");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("worstCaseUsd", () => {
  it("applies chars/4 tokens at the Hub's own prices, plus 10% margin", () => {
    const promptChars = 4_000_000; // -> 1,000,000 input tokens
    const maxOutputTokens = 1_000_000;
    const expected = (DEFAULT_PRICE_PER_MTOK_IN + DEFAULT_PRICE_PER_MTOK_OUT) * 1.1;
    expect(worstCaseUsd(promptChars, maxOutputTokens)).toBeCloseTo(expected, 6);
  });

  it("is zero for zero chars and zero output tokens", () => {
    expect(worstCaseUsd(0, 0)).toBe(0);
  });
});

describe("FileSpendLedger", () => {
  it("a tiny reservation on a fresh ledger succeeds (positive control)", () => {
    const ledger = new FileSpendLedger(file, 1.0);
    const id = ledger.reserve(0.01, "test");
    expect(id).not.toBeNull();
    expect(ledger.capUsd()).toBe(1.0);
  });

  it("refuses when the reservation would push spent+open over a tiny cap (0.001)", () => {
    const ledger = new FileSpendLedger(file, 0.001);
    const id = ledger.reserve(0.01, "too big for the cap");
    expect(id).toBeNull();
    expect(ledger.spentUsd()).toBe(0);
  });

  it("settle() books actual usage into spentUsd()", () => {
    const ledger = new FileSpendLedger(file, 1.0);
    const id = ledger.reserve(0.1, "call-1");
    expect(id).not.toBeNull();
    ledger.settle(id as string, 0.05, { inputTokens: 100, outputTokens: 50 });
    expect(ledger.spentUsd()).toBeCloseTo(0.05, 9);
  });

  it("a non-finite or negative worst case is refused outright", () => {
    const ledger = new FileSpendLedger(file, 1.0);
    expect(ledger.reserve(Number.NaN, "nan")).toBeNull();
    expect(ledger.reserve(-1, "negative")).toBeNull();
    expect(ledger.reserve(Infinity, "inf")).toBeNull();
  });

  it("settle() with a non-finite actual cost books the reservation's worst case instead", () => {
    const ledger = new FileSpendLedger(file, 1.0);
    const id = ledger.reserve(0.2, "call-1") as string;
    ledger.settle(id, Number.NaN, { inputTokens: 1, outputTokens: 1 });
    expect(ledger.spentUsd()).toBeCloseTo(0.2, 9);
  });

  it("settle() is idempotent — settling twice books the cost only once", () => {
    const ledger = new FileSpendLedger(file, 1.0);
    const id = ledger.reserve(0.1, "call-1") as string;
    ledger.settle(id, 0.05, { inputTokens: 10, outputTokens: 10 });
    ledger.settle(id, 0.09, { inputTokens: 10, outputTokens: 10 });
    expect(ledger.spentUsd()).toBeCloseTo(0.05, 9);
  });

  it("two ledger instances on one file see each other's spend", () => {
    const a = new FileSpendLedger(file, 1.0);
    const b = new FileSpendLedger(file, 1.0);

    const idA = a.reserve(0.4, "from-a");
    expect(idA).not.toBeNull();
    a.settle(idA as string, 0.4, { inputTokens: 10, outputTokens: 10 });

    // b must see a's settled spend without re-constructing.
    expect(b.spentUsd()).toBeCloseTo(0.4, 9);

    // b reserving another 0.4 is fine (0.4 + 0.4 = 0.8 <= 1.0)...
    const idB = b.reserve(0.4, "from-b");
    expect(idB).not.toBeNull();

    // ...but a's own next reserve call, seeing b's still-open 0.4 reservation
    // plus a's own settled 0.4, must refuse anything that would overshoot.
    const idA2 = a.reserve(0.3, "from-a-again");
    expect(idA2).toBeNull();
  });

  it("an open (unsettled) reservation from one instance blocks another instance's reserve, not just settled spend", () => {
    const a = new FileSpendLedger(file, 1.0);
    const b = new FileSpendLedger(file, 1.0);

    const idA = a.reserve(0.9, "big-hold");
    expect(idA).not.toBeNull();

    // b sees the OPEN reservation (not yet settled) and must refuse.
    const idB = b.reserve(0.2, "would-overshoot");
    expect(idB).toBeNull();
  });

  it("fails CLOSED on a corrupt ledger line (refuses new spend, does not silently under-count)", () => {
    fs.writeFileSync(file, "{not json\n");
    const ledger = new FileSpendLedger(file, 1.0);
    expect(ledger.reserve(0.01, "test")).toBeNull();
  });

  it("re-reads totals from the file on construction (a second instance starts aware of prior spend)", () => {
    const a = new FileSpendLedger(file, 1.0);
    const id = a.reserve(0.5, "call-1") as string;
    a.settle(id, 0.5, { inputTokens: 1, outputTokens: 1 });

    const b = new FileSpendLedger(file, 1.0);
    expect(b.spentUsd()).toBeCloseTo(0.5, 9);
  });
});
