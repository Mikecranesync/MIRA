/**
 * Output hygiene (#6004, #6030 F7): the PRODUCTION checker (capabilities/answer-hygiene.ts), not a copy.
 * The route-level release behaviour is covered by output-hygiene-release.route.test.ts.
 */
import { describe, expect, it } from "vitest";
import { OUTPUT_HYGIENE_FAILURE_TEXT, OUTPUT_HYGIENE_STATUS_MESSAGE, checkAnswerHygiene, expectedScripts, quotedRecovery } from "@/capabilities/answer-hygiene";
import { ANSWER_LANGUAGE_RULE, ENGLISH_ANSWER_RULE, looksNonEnglish, withAnswerLanguage } from "@/capabilities/answer-language";

const EN = { question: "What does fault F004 mean?" };
const ES = { question: "¿Qué significa el fallo F004?" };
const verdict = (text: string, ctx: Parameters<typeof checkAnswerHygiene>[1] = EN) => checkAnswerHygiene(text, ctx);

describe("unexpected scripts in a Latin-script turn", () => {
  it.each([
    ["Devanagari", "No puedo पुछि? Confirmo que el LED está en amarillo.", ES],
    ["Arabic", "The drive shows fault مشكلة F004.", EN],
    ["Cyrillic", "The parameter Ошибка is not set.", EN],
    ["CJK", "The fault code 错误 means overcurrent.", EN],
    ["Hangul", "The fault code 오류 means overcurrent.", EN],
  ])("flags %s prose", (_n, text, ctx) => {
    expect(verdict(text, ctx)).toMatchObject({ ok: false, code: "unexpected_script" });
  });
  it("accepts clean English and clean Spanish", () => {
    expect(verdict("F004 is an overcurrent fault. Check the motor cable for shorts [1].")).toEqual({ ok: true });
    expect(verdict("El LED amarillo indica que el CPU está en modo STOP [1].", ES)).toEqual({ ok: true });
  });
  it("Latin product codes, units and Greek unit symbols are ordinary", () => {
    expect(verdict("The GS11N-20P2 rated 5 Ω, 10 µF, 20 °C [1].")).toEqual({ ok: true });
  });
});

describe("expected scripts come from what the technician wrote", () => {
  it.each([
    ["Japanese", "F081 の意味は何ですか？", "F081 は通信障害です。タイプ2では手動リセットが必要です [1]。"],
    ["Arabic", "ما معنى العطل F081؟", "العطل F081 يعني فقد الاتصال [1]."],
    ["Hindi", "F081 का अर्थ क्या है?", "F081 का अर्थ संचार हानि है [1]।"],
    ["Russian", "Что означает F081?", "F081 означает потерю связи [1]."],
  ])("a valid %s answer to a %s question passes", (_n, q, a) => {
    expect(verdict(a, { question: q })).toEqual({ ok: true });
    expect(expectedScripts({ question: q }).size).toBe(1);
  });
  it("a different unexpected script inside a non-Latin answer is still flagged", () => {
    expect(verdict("F081 は通信障害です。ошибка [1]。", { question: "F081 の意味は何ですか？" })).toMatchObject({ ok: false, code: "unexpected_script" });
  });
  it("a Japanese thread keeps expecting Japanese on an identifier-only follow-up", () => {
    const ctx = { question: "F081?", priorUserTurns: ["F081 の意味は何ですか？"] };
    expect(verdict("F081 は通信障害です [1]。", ctx)).toEqual({ ok: true });
    expect(verdict("F081 は通信障害です [1]。", { question: "F081?" })).toMatchObject({ ok: false });
  });
  it("a clear English turn overrides an earlier Japanese turn: the current turn is the language contract", () => {
    const ctx = { question: "What does F081 mean?", priorUserTurns: ["F081 の意味を教えてください。"] };
    expect(verdict("F081 は通信障害です [1]。", ctx)).toMatchObject({ ok: false, code: "unexpected_script" });
    expect(verdict("F081 is DSI Comm Loss [1].", ctx)).toEqual({ ok: true });
    expect(expectedScripts(ctx).size).toBe(0);
  });
  it("a Japanese turn expects only its own script even after a Russian turn", () => {
    const ctx = { question: "F081 の意味を教えてください。", priorUserTurns: ["Что означает F081?"] };
    expect(Array.from(expectedScripts(ctx))).toEqual(["cjk"]);
  });
});

describe("legitimate source names do not exempt foreign prose", () => {
  const sources = ["Manual title: インバータ取扱説明書 (GS10)"];
  it("a non-Latin name that appears verbatim in the evidence is acceptable in an English answer", () => {
    expect(verdict("See the manual インバータ取扱説明書 for wiring [1].", { ...EN, sources })).toEqual({ ok: true });
  });
  it("without that evidence the same name is unexpected", () => {
    expect(verdict("See the manual インバータ取扱説明書 for wiring [1].", EN)).toMatchObject({ ok: false });
  });
  it("a legitimate Japanese source name does not exempt different Japanese prose", () => {
    const ctx = { question: "What does F081 mean?", sources: ["Source name: 三菱"] };
    expect(verdict("The name is 三菱. 通信障害 is the issue [1].", ctx)).toMatchObject({ ok: false, code: "unexpected_script" });
    expect(verdict("The manufacturer is 三菱 [1].", ctx)).toEqual({ ok: true });
  });
  it("a legitimate quoted name and a product code elsewhere do not exempt unexpected Cyrillic prose", () => {
    const text = 'PF525-TEST reports ошибка. See "インバータ取扱説明書" [1].';
    expect(verdict(text, { ...EN, sources })).toMatchObject({ ok: false, code: "unexpected_script" });
  });
});

describe("draft markers", () => {
  it.each([
    "No puedo? better Spanish: No puedo confirmar...",
    "Fault detected. rewrite: The drive shows F004.",
    "The LED means... let me rephrase: The yellow LED indicates STOP mode.",
    "F081 is not found. Wait, let me check again.",
    "No information. Actually, I should check the table.",
    "correction: F081 is Type 2.",
  ])("flags %j", (t) => expect(verdict(t)).toMatchObject({ ok: false, code: "draft_marker" }));
  it("does not flag ordinary instructions", () => {
    expect(verdict("Wait 5 minutes for the DC bus to discharge. Actually test with a meter first [1].")).toEqual({ ok: true });
    expect(verdict("Shielded cable is better than unshielded for long runs [1].")).toEqual({ ok: true });
  });
});

describe("quoted recovery and the failure text", () => {
  it("extracts a trailing quoted passage and the caller re-checks it", () => {
    const clean = "F081 means DSI Comm Loss and Type 2 requires manual reset [1].";
    expect(quotedRecovery(`rewrite: "${clean}"`)).toBe(clean);
    expect(quotedRecovery('rewrite: "short"')).toBeNull();
    expect(verdict(quotedRecovery(`rewrite: "F081 needs reset. rewrite: DSI [1]."`) ?? "")).toMatchObject({ ok: false });
  });
  it("the status message is about the reply, not the manuals", () => {
    expect(OUTPUT_HYGIENE_STATUS_MESSAGE).toMatch(/clean reply/);
    expect(OUTPUT_HYGIENE_STATUS_MESSAGE.toLowerCase()).not.toMatch(/not (found|contain)|insufficient|source|manual/);
  });
  it("the failure text blames the reply, not the manuals", () => {
    expect(OUTPUT_HYGIENE_FAILURE_TEXT).toMatch(/could not produce a clean reply/);
    expect(OUTPUT_HYGIENE_FAILURE_TEXT).toMatch(/nothing about your manuals/);
    expect(OUTPUT_HYGIENE_FAILURE_TEXT.toLowerCase()).not.toMatch(/not (found|contain)|insufficient|do not have/);
  });
});

describe("withAnswerLanguage never calls a non-Latin question English", () => {
  const plain = `SYS\n\n${ANSWER_LANGUAGE_RULE}`;
  it.each(["F081 の意味は何ですか？", "ما معنى العطل F081؟", "F081 का अर्थ क्या है?", "Что означает F081?"])("%s", (q) => {
    expect(withAnswerLanguage("SYS", q)).toBe(plain);
    expect(withAnswerLanguage("SYS", q)).not.toContain(ENGLISH_ANSWER_RULE);
  });
  it("control: an English question still states English; translation detection is unchanged", () => {
    expect(withAnswerLanguage("SYS", "What does F081 mean?")).toBe(`${plain} ${ENGLISH_ANSWER_RULE}`);
    expect(looksNonEnglish("F081 の意味は何ですか？")).toBe(false); // unchanged: no new translation call for these
  });
});
