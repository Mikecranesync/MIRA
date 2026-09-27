/**
 * Finished-answer actions: read-aloud and "record what fixed it".
 *
 * The shell renders a control only when its host hook exists, and both hosts
 * share the helpers here so the Hub and the phone speak the same words and file
 * a fix under the same symptom.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { getFixture, type InteractionTurn } from "@factorylm/interaction";
import { answerText, createReadAloud, fixSymptomFor, speakableText } from "../answer-actions";
import { renderHarness, type HarnessView } from "./harness";

const views: HarnessView[] = [];
afterEach(() => {
  views.splice(0).forEach((view) => view.cleanup());
});

function turnsOf(fixture: Parameters<typeof getFixture>[0]): readonly InteractionTurn[] {
  return getFixture(fixture).thread.turns;
}

describe("speakableText", () => {
  it("drops citation marks and markdown syntax a voice would read out", () => {
    const spoken = speakableText("**Check** the `P1.01` accel time [1].\n\n- Set it to 8 s [2, 3]\n## Next");
    expect(spoken).toBe("Check the P1.01 accel time.\nSet it to 8 s\nNext");
    expect(spoken).not.toContain("[");
    expect(spoken).not.toContain("*");
    expect(spoken).not.toContain("#");
  });

  it("keeps link text and leaves plain prose unchanged", () => {
    expect(speakableText("See [the manual](https://x/y.pdf) page 4")).toBe("See the manual page 4");
    expect(speakableText("Reset the drive")).toBe("Reset the drive");
  });
});

describe("fixSymptomFor", () => {
  it("files the fix under the question the answer replied to — the nearest earlier one", () => {
    const base = turnsOf("grounded-answer")[0]!;
    const turns: InteractionTurn[] = [
      { ...base, id: "q1", role: "user", parts: [{ type: "text", text: "old question" }] },
      { ...base, id: "a1", role: "assistant", parts: [{ type: "text", text: "old answer" }] },
      { ...base, id: "q2", role: "user", parts: [{ type: "text", text: "Drive trips  oC\non accel" }] },
      { ...base, id: "a2", role: "assistant", parts: [{ type: "text", text: "Raise accel time [1]" }] },
    ];
    expect(fixSymptomFor(turns, "a2")).toBe("Drive trips oC on accel");
    expect(fixSymptomFor(turns, "a1")).toBe("old question");
  });

  it("returns null when no question precedes the answer, and caps the symptom at 500 characters", () => {
    const turns = turnsOf("grounded-answer");
    const first = turns[0]!;
    expect(fixSymptomFor(turns, first.id)).toBeNull();
    const long: InteractionTurn[] = [
      { ...first, id: "q", role: "user", parts: [{ type: "text", text: "x".repeat(900) }] },
      { ...first, id: "a", role: "assistant", parts: [{ type: "text", text: "answer" }] },
    ];
    expect(fixSymptomFor(long, "a")?.length).toBe(500);
  });
});

describe("createReadAloud", () => {
  function fakeSynth() {
    const spoken: string[] = [];
    let cancels = 0;
    const synth = {
      speaking: false,
      speak(u: SpeechSynthesisUtterance) {
        spoken.push(u.text);
        synth.speaking = true;
      },
      cancel() {
        cancels += 1;
        synth.speaking = false;
      },
    };
    class Utterance {
      text: string;
      onend: (() => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
    }
    return { synth, Utterance: Utterance as unknown as new (t: string) => SpeechSynthesisUtterance, spoken, cancels: () => cancels };
  }

  it("is null where the platform cannot speak", () => {
    expect(createReadAloud(undefined, undefined)).toBeNull();
  });

  it("speaks the cleaned answer, and a second press on the same answer stops it", () => {
    const f = fakeSynth();
    const ra = createReadAloud(f.synth, f.Utterance)!;
    ra.toggle("t1", "Reset the drive [1].");
    expect(f.spoken).toEqual(["Reset the drive."]);
    expect(f.synth.speaking).toBe(true);
    ra.toggle("t1", "Reset the drive [1].");
    expect(f.synth.speaking).toBe(false);
    expect(f.spoken).toHaveLength(1);
  });

  it("switching answers stops the first and speaks the second", () => {
    const f = fakeSynth();
    const ra = createReadAloud(f.synth, f.Utterance)!;
    ra.toggle("t1", "First answer");
    const cancelsBefore = f.cancels();
    ra.toggle("t2", "Second answer");
    expect(f.cancels()).toBeGreaterThan(cancelsBefore);
    expect(f.spoken).toEqual(["First answer", "Second answer"]);
  });
});

describe("read-aloud lifecycle (Codex #4058)", () => {
  function recordingSynth() {
    const utterances: Array<{ text: string; onend: (() => void) | null }> = [];
    const synth = {
      speaking: false,
      speak(u: SpeechSynthesisUtterance) {
        utterances.push(u as unknown as { text: string; onend: (() => void) | null });
        synth.speaking = true;
      },
      cancel() {
        synth.speaking = false;
      },
    };
    class Utterance {
      text: string;
      onend: (() => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
    }
    return { synth, Utterance: Utterance as unknown as new (t: string) => SpeechSynthesisUtterance, utterances };
  }

  it("a late onend from a cancelled utterance cannot clear the newer one (F2)", () => {
    const f = recordingSynth();
    const ra = createReadAloud(f.synth, f.Utterance)!;
    ra.toggle("A", "first A");
    ra.toggle("B", "B");
    ra.toggle("A", "second A");
    f.utterances[0]!.onend?.(); // the FIRST A finishes late
    ra.toggle("A", "second A"); // must stop the second A, not restart it
    expect(f.synth.speaking).toBe(false);
    expect(f.utterances).toHaveLength(3);
  });

  it("stops when the conversation changes, and not when it stays the same (F1)", () => {
    const f = recordingSynth();
    const ra = createReadAloud(f.synth, f.Utterance)!;
    ra.scope("nb1:t1");
    ra.toggle("A", "answer A");
    ra.scope("nb1:t1");
    expect(f.synth.speaking).toBe(true);
    ra.scope("nb2:t9");
    expect(f.synth.speaking).toBe(false);
  });
});

describe("action row", () => {
  it("renders Read aloud and Record what fixed it only when their hooks exist, and reports the turn id", () => {
    const read: string[] = [];
    const fixes: string[] = [];
    const view = renderHarness({
      surface: "web",
      fixture: "grounded-answer",
      conversationSurface: "assistant",
      hooks: { onReadAloud: (id) => read.push(id), onRecordFix: (id) => fixes.push(id) },
    });
    views.push(view);
    const turn = view.container.querySelector<HTMLElement>('[data-turn-id][data-role="assistant"]');
    const id = turn?.dataset.turnId;
    const readBtn = turn?.querySelector<HTMLButtonElement>('[aria-label="Read aloud"]');
    const fixBtn = turn?.querySelector<HTMLButtonElement>('[aria-label="Record what fixed it"]');
    expect(id).toBeTruthy();
    expect(readBtn).not.toBeNull();
    expect(fixBtn).not.toBeNull();
    readBtn!.click();
    fixBtn!.click();
    expect(read).toEqual([id!]);
    expect(fixes).toEqual([id!]);
  });

  it("renders neither control without its hook", () => {
    const view = renderHarness({
      surface: "web",
      fixture: "grounded-answer",
      conversationSurface: "assistant",
      hooks: { onCopy: () => {} },
    });
    views.push(view);
    expect(view.container.querySelector('[aria-label="Read aloud"]')).toBeNull();
    expect(view.container.querySelector('[aria-label="Record what fixed it"]')).toBeNull();
  });
});
