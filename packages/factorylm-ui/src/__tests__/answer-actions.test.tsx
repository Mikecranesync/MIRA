/**
 * Finished-answer actions: read-aloud and "record what fixed it".
 *
 * The shell renders a control only when its host hook exists, and both hosts
 * share the helpers here so the Hub and the phone speak the same words and file
 * a fix under the same symptom.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { getFixture, type InteractionTurn } from "@factorylm/interaction";
import {
  answerText,
  createFixRequestIds,
  createReadAloud,
  fixRefusalMessage,
  fixSymptomFor,
  serverTurnIdFor,
  speakableText,
  spokenAnswerText,
} from "../answer-actions";
import { renderHarness, type HarnessView } from "./harness";

const views: HarnessView[] = [];
afterEach(() => {
  views.splice(0).forEach((view) => view.cleanup());
});

function turnsOf(fixture: Parameters<typeof getFixture>[0]): readonly InteractionTurn[] {
  return getFixture(fixture).thread.turns;
}

describe("speakableText", () => {
  it("drops only this turn's citation marks and keeps technical identifiers intact (Codex #4058 post-cap F1)", () => {
    const spoken = speakableText(
      "Set output [1] ON and output [2] OFF [1]. Clear fault [1234] on VFD_01, then VFD_02. _Verify_ the __run__ lamp.",
      new Set(["1"]),
    );
    expect(spoken).toBe("Set output [1] ON and output [2] OFF. Clear fault [1234] on VFD_01, then VFD_02. Verify the run lamp.");
  });

  it("drops no bracketed number at all when the turn has no citations", () => {
    expect(speakableText("Set output [1] ON [2].")).toBe("Set output [1] ON [2].");
  });

  it("drops citation marks and markdown syntax a voice would read out", () => {
    const spoken = speakableText(
      "**Check** the `P1.01` accel time [1].\n\n- Set it to 8 s [2][3]\n## Next",
      new Set(["1", "2", "3"]),
    );
    expect(spoken).toBe("Check the P1.01 accel time.\nSet it to 8 s\nNext");
    expect(spoken).not.toContain("[");
    expect(spoken).not.toContain("*");
    expect(spoken).not.toContain("#");
  });

  it("keeps a fenced block's contents and drops only the fences and language label", () => {
    const spoken = speakableText("Set the drive parameter as follows:\n```text\nP1.01 = 8 s\n```\nRestart.");
    expect(spoken).toContain("P1.01 = 8 s");
    expect(spoken).toContain("Restart.");
    expect(spoken).not.toContain("```");
    expect(spoken).not.toContain("text\n");
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
    ra.toggle("t1", "**Reset** the drive.");
    expect(f.spoken).toEqual(["Reset the drive."]);
    expect(f.synth.speaking).toBe(true);
    ra.toggle("t1", "**Reset** the drive.");
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

describe("read-aloud speaks safety first (Codex #4058 round 2)", () => {
  it("speaks every safety notice before the answer, in order, in the shell's words", () => {
    const base = turnsOf("grounded-answer")[0]!;
    const turn: InteractionTurn = {
      ...base,
      id: "a",
      role: "assistant",
      parts: [
        { type: "text", text: "Replace the contactor [1]." },
        { type: "safety_notice", notice: { severity: "stop", message: "De-energize, lock out, and verify absence of voltage." } },
        { type: "safety_notice", notice: { severity: "warning", message: "Stored energy in the DC bus." } },
      ],
    };
    const spoken = spokenAnswerText(turn);
    expect(spoken).toBe(
      "Stop. De-energize, lock out, and verify absence of voltage.\n\nWarning. Stored energy in the DC bus.\n\nReplace the contactor [1].",
    );
    expect(spoken.indexOf("De-energize")).toBeLessThan(spoken.indexOf("Replace the contactor"));
  });

  it("a second press before playback starts stops instead of restarting", () => {
    const utterances: string[] = [];
    let cancels = 0;
    // An engine that has queued but not yet started speaking.
    const synth = { speaking: false, speak: (u: SpeechSynthesisUtterance) => void utterances.push(u.text), cancel: () => void (cancels += 1) };
    class Utterance { text: string; onend: (() => void) | null = null; constructor(t: string) { this.text = t; } }
    const ra = createReadAloud(synth, Utterance as unknown as new (t: string) => SpeechSynthesisUtterance)!;
    ra.toggle("A", "answer A");
    const cancelsAfterFirst = cancels;
    ra.toggle("A", "answer A");
    expect(utterances).toEqual(["answer A"]);
    expect(cancels).toBeGreaterThan(cancelsAfterFirst);
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

  it("hides Record what fixed it on an answer the host cannot record against (Codex #4058 post-cap F1)", () => {
    const asked: string[] = [];
    const view = renderHarness({
      surface: "web",
      fixture: "grounded-answer",
      conversationSurface: "assistant",
      hooks: {
        onReadAloud: () => {},
        onRecordFix: () => {},
        canRecordFix: (id) => {
          asked.push(id);
          return false;
        },
      },
    });
    views.push(view);
    const turn = view.container.querySelector<HTMLElement>('[data-turn-id][data-role="assistant"]');
    expect(turn?.querySelector('[aria-label="Read aloud"]')).not.toBeNull();
    expect(turn?.querySelector('[aria-label="Record what fixed it"]')).toBeNull();
    expect(asked).toContain(turn!.dataset.turnId!);
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

describe("record-fix request ids", () => {
  const counter = () => {
    let n = 0;
    return () => `id-${(n += 1)}`;
  };

  it("keeps one id for the same fix until it is saved, so a retry cannot duplicate it", () => {
    const ids = createFixRequestIds(counter());
    const first = ids.idFor("t1", "replaced the fuse");
    expect(ids.idFor("t1", "replaced the fuse")).toBe(first);
    ids.settle("t1", "replaced the fuse");
    expect(ids.idFor("t1", "replaced the fuse")).not.toBe(first);
  });

  it("gives a different fix, or the same fix under another answer, its own id", () => {
    const ids = createFixRequestIds(counter());
    const a = ids.idFor("t1", "replaced the fuse");
    expect(ids.idFor("t1", "reset the overload")).not.toBe(a);
    expect(ids.idFor("t2", "replaced the fuse")).not.toBe(a);
  });

  it("names the refusals a technician can act on and nothing else", () => {
    expect(fixRefusalMessage("asset_not_confirmed")).toContain("Confirm which machine");
    expect(fixRefusalMessage("asset_binding_changed")).toContain("machine changed");
    expect(fixRefusalMessage("request_id_conflict")).not.toBeNull();
    expect(fixRefusalMessage("answer_machine_mismatch")).toContain("different machine");
    expect(fixRefusalMessage("source_turn_not_found")).toContain("Reload");
    expect(fixRefusalMessage("HTTP 503")).toBeNull();
    expect(fixRefusalMessage(undefined)).toBeNull();
  });
});

describe("serverTurnIdFor (Codex #4058 post-cap F1)", () => {
  const ROW = "0b7c1a2e-3f4d-4a5b-8c6d-7e8f90a1b2c3";

  it("reads the server turn uuid behind a persisted answer id, lower-cased", () => {
    expect(serverTurnIdFor(`${ROW}-a`)).toBe(ROW);
    expect(serverTurnIdFor(`${ROW.toUpperCase()}-a`)).toBe(ROW);
  });

  it("is null for a question, a live or pending answer, or anything else", () => {
    expect(serverTurnIdFor(`${ROW}-q`)).toBeNull();
    expect(serverTurnIdFor("live-0-a")).toBeNull();
    expect(serverTurnIdFor("pending-a")).toBeNull();
    expect(serverTurnIdFor(`x${ROW}-a`)).toBeNull();
    expect(serverTurnIdFor(`${ROW}-a-a`)).toBeNull();
  });
});
