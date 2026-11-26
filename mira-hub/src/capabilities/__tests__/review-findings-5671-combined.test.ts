/**
 * Combined model-correctness release (#5671 + #5764): the pinned reviews' findings,
 * one describe per finding id (ledger: combined-model-native-ledger.json), judged on
 * the real parsers. Every "must refuse" has a "must accept" control.
 */
import { describe, expect, it } from "vitest";
import { buildPhotoSourceText } from "../photo-document-text";
import {
  manualAnswersFor,
  nearMissOf,
  questionModelNumbers,
  summarizeUnlistedRefusals,
  unlistedModelNumbers,
  unlistedModelRefusalText,
  type ManualVerdict,
} from "../manual-applicability";
import { recordModelNumbers } from "../manual-applicability";
import { carriesEarlierSubject, leansOnEarlierQuestion } from "../conversation-subject";

const verdict = (q: string, cover: string, file: string) => manualAnswersFor(unlistedModelNumbers(q), cover, file);
const refused = (v: ManualVerdict) => {
  if (!("kind" in v)) throw new Error("expected a refusal, got an admission");
  return v;
};
const replyFor = (vs: ManualVerdict[], source: "question" | "conversation" = "question") =>
  unlistedModelRefusalText(summarizeUnlistedRefusals(vs.map(refused), source));

const MICRO820 = "Installation Instructions\nMicro820 20-Point Programmable Controllers\n"
  + "Catalog Numbers 2080-LC20-20QWB, 2080-LC20-20QBB,\n2080-LC20-20AWB, 2080-LC20-20QWBR,\n2080-LC20-20QBBR, 2080-LC20-20AWBR";

describe("5671-r1-F1: an underscore phrase is not a publisher language/format signature", () => {
  it("a name carrying 1234-BR100 conflicts with a 1234-BR200 cover (was admitted)", () => {
    expect(verdict("voltage of the 1234-BR200?", "1234-BR200 Drive User Manual", "1234-BR100_is_a_copy.pdf"))
      .toMatchObject({ admit: false, kind: "cover-and-file-disagree" });
  });
  it("the matching identifier is not stripped from an ordinary name (was refused)", () => {
    expect(verdict("voltage of the 1234-BR100?", "1234-BR100 Drive User Manual", "1234-BR100_is_a_copy_1234-BR200.pdf")).toEqual({ admit: true });
  });
  it.each(["1234-BR100_IS_A_copy.pdf", "1234-BR100_of_a_set.pdf", "1234-BR100_en_a_copy.pdf", "1234-BR100_en_x.pdf", "1234-BR100_no_p_copy.pdf"])(
    "other ordinary underscore words keep the identifier: %s", (file) => {
      expect(verdict("voltage of the 1234-BR200?", "1234-BR200 Drive User Manual", file)).toMatchObject({ kind: "cover-and-file-disagree" });
    });
  it.each(["2080-IN009B_EN_P.pdf", "2080-IN009B-EN_P.pdf", "2080-in009b_en_p (1).pdf", "2080-IN009B_EN_P_v2.pdf"])(
    "control: the publisher forms still name the document: %s", (file) => {
      expect(verdict("relay on the 2080-LC20-20QWB?", MICRO820, file)).toEqual({ admit: true });
    });
});

describe("5671-r1-F2: a photo reading is not a manual declaration", () => {
  const manual = () => refused(verdict("rating of the RX420?", "RX435 Logic Controller User Manual", "m.pdf"));
  const photo = () => {
    const body = buildPhotoSourceText({ machineName: "CV-101", fileId: "f1", photoSha256: null, capturedAt: null, observation: "Nameplate: RX410 Logic Controller" });
    return refused(manualAnswersFor(unlistedModelNumbers("rating of the RX420?"), body, "photo.jpg", "photo_text"));
  };
  it("RX435 manual + RX410 photo reading: no suggestion of RX410, and RX410 is not attributed to the manual", () => {
    const text = replyFor([manual(), photo()]);
    expect(text).not.toMatch(/Did you mean/);
    expect(text).toMatch(/RX435/);
    expect(text).not.toMatch(/RX410/);
  });
  it("control: a manual cover that declares RX410 does suggest it", () => {
    const text = replyFor([refused(verdict("rating of the RX420?", "RX410 Logic Controller User Manual", "m.pdf")), photo()]);
    expect(text).toMatch(/Did you mean the RX410\?/);
  });
  it("control: a photo alone is still reported as a photo reading", () => {
    expect(replyFor([photo()])).toMatch(/photo reading/);
  });
});

describe("5671-r1-F3/F4: equivalent spellings are one identity", () => {
  const ASCII = "2080-LC20-20QWD";
  const UNI = "2080‑LC20‑20QWD";
  it("a non-breaking-hyphen spelling gets the same suggestion as the ASCII one (was a flat refusal)", () => {
    const a = replyFor([refused(verdict(`voltage of ${ASCII}?`, MICRO820, "2080-IN009B_EN_P.pdf"))]);
    const u = replyFor([refused(verdict(`voltage of ${UNI}?`, MICRO820, "2080-IN009B_EN_P.pdf"))]);
    expect(a).toMatch(/Did you mean the 2080-LC20-20QWB\?/);
    expect(u).toMatch(/Did you mean the 2080-LC20-20QWB\?/);
  });
  it("the Unicode spelling asks about one number, and the fragments are not listed as declared", () => {
    const v = refused(verdict(`voltage of ${UNI}?`, MICRO820, "2080-IN009B_EN_P.pdf"));
    expect(v.asked).toEqual([UNI]);
    expect(v.declared.every((d) => d.startsWith("2080-"))).toBe(true);
  });
  it("two spellings of one declared model are one correction candidate", () => {
    const cover = "Micro820 Controllers\nCatalog Numbers 2080-LC20-20QWB, 2080‑LC20‑20QWB";
    const v = refused(verdict(`voltage of ${ASCII}?`, cover, "m.pdf"));
    expect(v.declared).toHaveLength(1);
    expect(nearMissOf(summarizeUnlistedRefusals([v], "question"))).toBe("2080-LC20-20QWB");
  });
  it("control: two separately written, different numbers stay two", () => {
    const v = refused(verdict("compare the RX420 and the RX430?", "RX410 Logic Controller", "m.pdf"));
    expect(v.asked.sort()).toEqual(["RX420", "RX430"]);
  });
});

describe("question-scope tokens never pick the model (#5720 Fatek / #5671 acceptance 1)", () => {
  it.each([
    ["fatek fbs port2 rs485 not talkin to the hmi. wat baud is it by default", []],
    ["what does fault F0004 mean", []],
    ["alarm C2000 on the panel", []],
    ["parameter P0210 and the R4158 register", []],
    ["What does CE10 mean?", []],
    // Gus's G1 turn (#5720 body, verbatim): five codes in one question, none of them a model.
    ["Picking up Earl's thread. For F30001, F30002, F30003, F07900 and C01700 — stop response and acknowledgment for each, and what that response does to the motor. Page refs.", []],
  ])("%s", (text, expected) => {
    expect(questionModelNumbers(text).map((n) => n.label)).toEqual(expected);
  });
  it("controls: a model stays a model, and so does C2000 with no cue", () => {
    expect(questionModelNumbers("fault F0004 on the RX420").map((n) => n.label)).toEqual(["RX420"]);
    expect(questionModelNumbers("the plate reads RX420").map((n) => n.label)).toEqual(["RX420"]);
    expect(questionModelNumbers("wiring of the C2000").map((n) => n.label)).toEqual(["C2000"]);
  });
});

describe("a refusal belongs to the question that named the product (#5720 Comfort)", () => {
  const earlier = ["KTP400 Comfort - what volts min max"];
  it("an unrelated question of its own stands alone (English and Spanish)", () => {
    expect(carriesEarlierSubject("how long do I wait after power-off before touching the rear terminals", earlier)).toBe(false);
    expect(carriesEarlierSubject("una mas — cuanto espacio necesito detras del panel pa la ventilacion?", earlier)).toBe(false);
  });
  it("controls: pointers, a bare code, the same topic again and a plate statement still carry", () => {
    expect(carriesEarlierSubject("and its current?", earlier)).toBe(true);
    expect(carriesEarlierSubject("what does fault F0004 mean", earlier)).toBe(true);
    expect(carriesEarlierSubject("what volts does the panel want", earlier)).toBe(true);
    expect(carriesEarlierSubject("what supply current is needed", ["The plate reads GS11N-20P2. It will not start."])).toBe(true);
    expect(leansOnEarlierQuestion("huh?")).toBe(true);
  });
});

describe("the project's own record is read as recorded", () => {
  it("a recorded number shaped like a register or a port is still the machine's number; as a question token it is not a model", () => {
    expect(recordModelNumbers("R4158").map((n) => n.label)).toEqual(["R4158"]);
    expect(unlistedModelNumbers("R4158")).toEqual([]);
    expect(questionModelNumbers("R4158")).toEqual([]);
  });
});

describe("a pointer in another language leans on the earlier subject (parent language finding)", () => {
  it.each([
    "¿Cuál es el voltaje de alimentación de ese controlador?", "¿Y su corriente nominal?", "¿Qué tensión tiene esto?", "¿Cómo lo reinicio?", "¿Y el otro?",
    "Quelle est la tension nominale de ce contrôleur ?", "Et son courant nominal ?", "Combien de courant consomme-t-il ?", "Pourquoi elle ne démarre pas ?",
    "Welche Spannung benötigt dieser Controller?", "Und was ist sein Nennstrom?", "Wie lange hält er durch?", "Gilt das auch für den anderen?",
    "Qual è la tensione di questo controllore?", "Qual é a tensão deste controlador?",
  ])("leans: %s", (q) => {
    expect(leansOnEarlierQuestion(q)).toBe(true);
  });
  it.each([
    "¿Cuánto espacio necesito para la ventilación del gabinete?",
    "una mas — cuanto espacio necesito detras del panel pa la ventilacion?",
    "Quel dégagement de ventilation faut-il laisser autour du boîtier ?",
    "Wie viel Platz brauche ich für die Belüftung des Gehäuses?",
    "Quanto spazio serve per la ventilazione dell'armadio?",
  ])("controls: a question of its own stands alone: %s", (q) => {
    expect(leansOnEarlierQuestion(q)).toBe(false);
    expect(carriesEarlierSubject(q, ["RX420 will not start"])).toBe(false);
  });
  it("a text in no listed language fails closed; English with no pointer does not", () => {
    expect(leansOnEarlierQuestion("Jaki jest wymagany odstęp wentylacyjny wokół obudowy?")).toBe(true);
    expect(leansOnEarlierQuestion("how much ventilation clearance do I leave around the case")).toBe(false);
  });
  it("impersonal 'il faut' / 'es gibt' are no pointer; the pronoun 'il' / 'er' beside a real verb is", () => {
    expect(leansOnEarlierQuestion("Que faut-il vérifier avant de couper l'alimentation du boîtier ?")).toBe(false);
    expect(leansOnEarlierQuestion("Gibt es eine Mindestabstand für die Belüftung des Schranks?")).toBe(false);
    expect(leansOnEarlierQuestion("Est-ce qu'il démarre avec 24 V ?")).toBe(true);
  });
});

describe("a trip-shaped token the text calls a product is a model (M12 follow-up)", () => {
  it.each([
    ["the HF100 drive will not start", ["HF100"]], ["model HF100", ["HF100"]], ["catalog no. HF100", ["HF100"]], ["supply voltage of the HF200 controller", ["HF200"]],
    ["what does HF100 mean", []], ["fault HF100", []], ["CE10", []],
  ])("%s", (text, expected) => {
    expect(questionModelNumbers(text).map((n) => n.label)).toEqual(expected);
  });
});
