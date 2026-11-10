/**
 * Synthetic technician — "I typed what the plate says."
 *
 * A technician opens a blank chat and types the machine the way its nameplate
 * or data sheet reads. MIRA should offer that machine ("Is this a …?") so one
 * tap binds the notebook and its manual search starts. These are the garage
 * bench parts, typed the way their own public documents title them.
 *
 * What this file proves, and what it does not:
 *  - PROVES (deterministic, $0, no network): the proposal the chat route
 *    computes from typed text, and that the identity it proposes is one the
 *    manual-admission step then protects.
 *  - DOES NOT PROVE: that production's shared library lists these makers (the
 *    proposal only fires for makers it holds), or anything on a screen.
 *
 * MAKERS is the subset of staging's shared-library maker list that matters
 * here, read 2026-11-09 (read-only). It is a fixture, not live verification.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { isSafeCandidateSearchIdentity } from "@/capabilities/candidate-identity";
import { familyNamedWithItsCatalogNumber, namesOnlyThisMachine, proposeIdentityFromText } from "@/capabilities/identity-proposal";
import { retrieveNodeChunks } from "@/lib/manual-rag";

const MAKERS = ["Rockwell Automation", "AutomationDirect", "Schneider Electric", "Siemens"];
const propose = (typed: string) => proposeIdentityFromText(typed, MAKERS);

describe("the relay, typed the way its data sheet titles it", () => {
  // Public data sheet for CA3KN22BD: "TeSys K control relay", "Range TeSys".
  it.each([
    ["Schneider Electric TeSys CA3KN22BD", "Schneider Electric"],
    ["Schneider TeSys CA3KN22BD control relay, what is the coil voltage?", "Schneider"],
    ["Schneider Electric TeSys K CA3KN22BD", "Schneider Electric"],
    ["Schneider Electric TeSys K: CA3KN22BD", "Schneider Electric"],
    ["Schneider Electric TeSys K, CA3KN22BD", "Schneider Electric"],
  ])("%s", (typed, maker) => {
    expect(propose(typed)).toEqual({ manufacturer: maker, model: "CA3KN22BD" });
  });

  it("another member of the range reads the same way", () => {
    expect(propose("Schneider Electric TeSys D LC1D09BD contactor will not pull in")).toEqual({
      manufacturer: "Schneider Electric",
      model: "LC1D09BD",
    });
  });

  it("control: without the range name it was already proposed", () => {
    expect(propose("Schneider Electric CA3KN22BD relay coil voltage")).toEqual({
      manufacturer: "Schneider Electric",
      model: "CA3KN22BD",
    });
  });

  it.each([
    ["the range name alone names no machine", "Schneider Electric TeSys"],
    ["the range and its letter alone name no machine", "Schneider Electric TeSys K control relay keeps chattering"],
    ["a letters-only code after the range is not a model", "Schneider Electric TeSys LC-D"],
    ["two different relays are a comparison", "Schneider Electric TeSys CA3KN22BD or CA3KN31BD?"],
    ["a serial label's value is never the model", "Schneider Electric TeSys SN: CA3KN22BD"],
    ["a rating after the range is not a model", "Schneider Electric TeSys 24VDC coil"],
    ["a maker the library does not hold is never proposed", "Dorner TeSys CA3KN22BD"],
    // TeSys is Schneider's range. After another maker's name it is a maker and a
    // range that do not belong together, and the number is not given to that maker.
    ["the range after another maker's name", "Allen-Bradley TeSys K CA3KN22BD"],
    ["the same, without the range letter", "Siemens TeSys CA3KN22BD"],
    ["the same, in a sentence", "The AutomationDirect TeSys K CA3KN22BD relay chatters"],
    // Known limit, on purpose: the number must sit directly after the range name.
    ["words between the range and the number (the data sheet's full title)", "The Schneider Electric TeSys K control relay CA3KN22BD is chattering"],
    ["a number further along may be another machine's", "Schneider Electric TeSys K relay feeds the GS11N-20P2"],
    ["a lowercase letter is a word, not a range member", "Schneider Electric TeSys a CA3KN22BD"],
  ])("still nothing: %s", (_why, typed) => {
    expect(propose(typed)).toBeNull();
  });

  // Cheap review round 9 on #5387. The number after the range name was given to
  // Schneider whatever it was. The family table in the same file lists these
  // numbers as an Allen-Bradley Micro820's, so the card named a machine the
  // file itself knows is another maker's. Main gives no card for these.
  it.each([
    ["Schneider Electric TeSys 2080-LC20-20QBB"],
    ["Schneider Electric TeSys K 2080-LC20-20QBB"],
    ["Schneider Electric TeSys D 2080-L20E-20QWBR has a red fault light"],
    ["The Schneider Electric TeSys 2080-LC20-20AWB, which manual should I use?"],
  ])("a number the family table lists as another maker's is not given to the range's maker: %s", (typed) => {
    expect(propose(typed)).toBeNull();
  });

  // Main's own card for the same contradiction in the plain wording is not
  // changed here (#5395): main's reading runs first and its card is returned.
  it.each([
    ["Schneider Electric 2080-LC20-20QBB", "Schneider Electric"],
    ["Siemens 2080-LC20-20QBB", "Siemens"],
  ])("a gap that is on main gives the same card as main: %s", (typed, manufacturer) => {
    expect(propose(typed)).toEqual({ manufacturer, model: "2080-LC20-20QBB" });
  });

  // KNOWN LIMIT, pinned. A number no list in this file attributes to a maker is
  // still given to the range's maker, as main gives any number to the maker
  // named before it: another family's number, a look-alike, another maker's.
  it.each([
    ["Schneider Electric TeSys 2080-LC50-24QWB"],
    ["Schneider Electric TeSys 2080-LC20-99ZZZ"],
    ["Schneider Electric TeSys 6ES7214-1AG40-0XB0"],
  ])("known limit: a number no list attributes is still proposed under the range's maker: %s", (typed) => {
    expect(propose(typed)).toEqual({ manufacturer: "Schneider Electric", model: typed.split(" ").pop() });
  });
});

describe("the PLC, typed with both lines of its plate", () => {
  // Rockwell publication 2080-UM005 (Micro820 user manual), cover: the family
  // name and its catalog numbers are printed together.
  it.each([
    "Allen-Bradley Micro820 2080-LC20-20QBB",
    "Allen-Bradley Micro820 2080-LC20-20QBB has a red fault light",
    "Rockwell Automation Micro820 (2080-LC20-20QBB) will not go to run",
    "Allen-Bradley 2080-LC20-20QBB Micro820",
  ])("%s → the family, not the catalog number", (typed) => {
    expect(propose(typed)?.model).toBe("820");
  });

  it("the catalog number first and the family later in the sentence still binds the family", () => {
    expect(propose("Allen-Bradley 2080-LC20-20QBB keeps faulting, it is the Micro820 on the conveyor")).toEqual({
      manufacturer: "Allen-Bradley",
      model: "820",
    });
  });

  it("controls: either line alone was already proposed, unchanged", () => {
    expect(propose("Allen-Bradley Micro820")).toEqual({ manufacturer: "Allen-Bradley", model: "820" });
    expect(propose("Allen-Bradley 2080-LC20-20QBB")).toEqual({ manufacturer: "Allen-Bradley", model: "2080-LC20-20QBB" });
  });

  it.each([
    ["another family's name beside this catalog number", "Allen-Bradley Micro850 2080-LC20-20QBB"],
    ["this family's name beside a catalog number its manual does not list", "Allen-Bradley Micro820 2080-LC50-24QBB"],
    ["a catalog number that only looks like the family's", "Allen-Bradley Micro820 2080-LC20-99ZZZ"],
    ["two different catalog numbers", "Allen-Bradley Micro820 2080-LC20-20QBB and 2080-LC20-20QWB"],
    ["a second machine in the same message", "Allen-Bradley Micro820 2080-LC20-20QBB talks to a PowerFlex 525"],
    ["another maker's part with the same family words", "Siemens Micro820 2080-LC20-20QBB"],
  ])("still nothing: %s", (_why, typed) => {
    expect(propose(typed)).toBeNull();
  });

  // Review round 2 on #5387: the pairing counts DISTINCT listed catalog numbers,
  // so the same number typed twice is still one machine. That is the rule the
  // proposal already had for any model ("repeating the chosen model ... still
  // proposes"), not a new one: a technician who types the plate line and then
  // the fault sentence names the number twice. A second DIFFERENT number is the
  // comparison, and it is refused two rows up.
  it.each([
    "Allen-Bradley Micro820 2080-LC20-20QBB and 2080-LC20-20QBB",
    "Allen-Bradley Micro820 2080-LC20-20QBB. The 2080-lc20-20qbb will not go to run",
    "Allen-Bradley 2080-LC20-20QBB Micro820, plate reads 2080-LC20-20QBB",
    "Allen-Bradley Micro820 2080-LC20-20QBB, the Micro820 has a red fault light",
  ])("the same catalog number or family typed twice is still one machine: %s", (typed) => {
    const proposed = propose(typed);
    expect(proposed).toEqual({ manufacturer: "Allen-Bradley", model: "820" });
    expect(isSafeCandidateSearchIdentity("", typed, proposed!.model, proposed!.manufacturer)).toBe(false);
    expect(namesOnlyThisMachine(typed, proposed!.model)).toBe(false);
  });

  it.each([
    ["the same number twice and a different one", "Allen-Bradley Micro820 2080-LC20-20QBB and 2080-LC20-20QBB and 2080-LC20-20QWB"],
    ["the same number twice beside another family's name", "Allen-Bradley Micro850 2080-LC20-20QBB and 2080-LC20-20QBB"],
    ["the same number twice and a second machine", "Allen-Bradley Micro820 2080-LC20-20QBB, 2080-LC20-20QBB, and a PowerFlex 525"],
  ])("repeating the number does not get a comparison through: %s", (_why, typed) => {
    expect(propose(typed)).toBeNull();
  });

  // Review round 4 on #5387: the plate plus a sibling or an accessory from the
  // SAME maker. Two checks refuse these: a message that names two models the
  // detector reads proposes nothing, and the pairing needs every mention that
  // is not a listed catalog number to be this family itself. Removing either
  // one alone leaves most of these refused; removing both turns all seven red.
  // One wall only: "Micro 850" with a space is not a model mention, so that
  // row is held by the first check alone, and the last three (parts the
  // detector does not read) by the second alone.
  it.each([
    ["a sibling family", "Allen-Bradley Micro820 2080-LC20-20QBB and a Micro850"],
    ["a sibling family, no space before the digits or one", "Allen-Bradley Micro820 2080-LC20-20QBB and a Micro 850"],
    ["a sibling with its own catalog number", "Allen-Bradley Micro820 2080-LC20-20QBB, the old one was a Micro850 2080-LC50-24QBB"],
    ["the range name the family belongs to", "Allen-Bradley Micro820 2080-LC20-20QBB compare with Micro800"],
    ["an older controller line", "Allen-Bradley Micro820 2080-LC20-20QBB and a MicroLogix 1400"],
    ["a plug-in module", "Allen-Bradley Micro820 2080-LC20-20QBB with the 2080-IF4 plug-in"],
    ["the controller it replaces", "Allen-Bradley Micro820 2080-LC20-20QBB replaces the 1766-L32BWA"],
  ])("the plate beside a same-maker sibling or accessory proposes nothing: %s", (_why, typed) => {
    expect(propose(typed)).toBeNull();
  });

  // Codex round 1 on #5387 (F1): a second machine whose name has no digit in it
  // ("SMC Flex") is invisible to the mention scan, which only sees a token with
  // a digit. With the plate's two lines now read as one machine, the message
  // was proposed as that machine. The shared model detector does read it. A
  // proposal this change newly makes (the family pairing, the range name) is
  // now put to that detector, and a model it reads that is not the proposed
  // machine removes the card. The two wordings Codex ran are the first two
  // rows; each proposed on the reviewed head and proposed nothing on main.
  it.each([
    ["the PLC plate and a digitless second machine (Codex's message)", "Allen-Bradley Micro820 2080-LC20-20QBB and an SMC Flex both faulted, which manual should I use?"],
    ["the relay and a digitless second machine (Codex's message)", "Schneider Electric TeSys K CA3KN22BD and an SMC Flex both faulted"],
    ["the catalog number first, the family later, and the second machine", "Allen-Bradley 2080-LC20-20QBB is the Micro820, and the SMC Flex beside it tripped"],
    ["the relay without its range letter", "Schneider Electric TeSys CA3KN22BD and an SMC Flex both faulted"],
    ["lower case", "Allen-Bradley Micro820 2080-LC20-20QBB and an smc flex both faulted"],
  ])("a second machine with no digit in its name proposes nothing: %s", (_why, typed) => {
    expect(propose(typed)).toBeNull();
  });

  it("controls: the same plates without the second machine are still proposed", () => {
    expect(propose("Allen-Bradley Micro820 2080-LC20-20QBB both lights faulted, which manual should I use?")).toEqual({
      manufacturer: "Allen-Bradley",
      model: "820",
    });
    expect(propose("Schneider Electric TeSys K CA3KN22BD faulted")).toEqual({ manufacturer: "Schneider Electric", model: "CA3KN22BD" });
    expect(propose("Allen-Bradley Micro820 faulted")).toEqual({ manufacturer: "Allen-Bradley", model: "820" });
  });

  // Codex round 2 on #5387 (F3). The first version of that rule was put to
  // EVERY proposal, and it read a rating or a count typed after the machine as
  // a second model: the detector lets a bare number after a comma or "and"
  // inherit the family before it ("PowerFlex 523 and 525"), so "Micro820,
  // 24 VDC" also read as a "Micro 24". Each row here is one machine, proposes
  // on main, and proposed nothing on the reviewed head. The rule is now put
  // only to the proposals this change adds, so a message main proposes is
  // never put to it. The first three rows are the messages Codex ran.
  it.each([
    ["a supply voltage (Codex's message)", "Allen-Bradley Micro820, 24 VDC supply", "Allen-Bradley", "820"],
    ["input and output counts (Codex's message)", "Allen-Bradley Micro820, 16 inputs, 12 outputs", "Allen-Bradley", "820"],
    ["another maker's drive and its voltage (Codex's message)", "ABB ACS580, 400 V supply", "ABB", "ACS580"],
    ["a bare number with no unit", "Allen-Bradley Micro820, 24", "Allen-Bradley", "820"],
    ["a drive, power and voltage", "Allen-Bradley PowerFlex 525, 10 HP, 480 V", "Allen-Bradley", "525"],
    ["a drive and a count", "Allen-Bradley PowerFlex 525, 16 inputs", "Allen-Bradley", "525"],
    ["a drive and a slash before the voltage", "Allen-Bradley PowerFlex 525 / 480 V", "Allen-Bradley", "525"],
    ["a power rating that is also a sibling's number", "Allen-Bradley PowerFlex 755, 753 HP", "Allen-Bradley", "755"],
    ["a current rating that is also a sibling's number", "Allen-Bradley Micro820, 850 mA", "Allen-Bradley", "820"],
    ["the family's own series number", "Allen-Bradley Micro820, 800 series", "Allen-Bradley", "820"],
    ["a starter named by its catalog number and then its family in words", "Allen-Bradley 150-F43NBD SMC Flex", "Allen-Bradley", "150-F43NBD"],
  ])("one machine with a rating, a count or its family after it is proposed, as on main: %s", (_why, typed, manufacturer, model) => {
    expect(proposeIdentityFromText(typed, [...MAKERS, "ABB"])).toEqual({ manufacturer, model });
  });

  // What is NOT changed, pinned so a change is seen. Each of these names a
  // second machine that main's mention scan does not see, and main proposes the
  // first one. That gap is on main, it is not closed here, and this branch
  // gives the same card (the first version of the rule removed these; that is
  // taken back). Filed as #5395 and listed in the PR text.
  it.each([
    ["a second machine in words alone", "Allen-Bradley Micro820 and an SMC Flex both faulted", "Allen-Bradley", "820"],
    ["the same beside a catalog number", "Schneider Electric CA3KN22BD and an SMC Flex both faulted", "Schneider Electric", "CA3KN22BD"],
    ["a sibling written as a bare number", "Allen-Bradley Micro820 and 850", "Allen-Bradley", "820"],
    ["two drives of one series", "Allen-Bradley PowerFlex 523 and 525", "Allen-Bradley", "523"],
    ["a drive family with no table", "ABB ACS580 and 880", "ABB", "ACS580"],
    ["a second maker's machine, far from the relay", "Siemens 2200 and Schneider Electric CA3KN22BD", "Schneider Electric", "CA3KN22BD"],
    ["a second maker's machine, far from the PLC", "The Siemens panel is fine but the Allen-Bradley Micro820 faulted", "Allen-Bradley", "820"],
    ["a second product line in a word alone", "Allen-Bradley Micro820 and a PowerFlex", "Allen-Bradley", "820"],
    ["a second series name", "Schneider Electric CA3KN22BD and the Altivar", "Schneider Electric", "CA3KN22BD"],
  ])("a gap that is on main (#5395) and is not closed here gives the same card as main: %s", (_why, typed, manufacturer, model) => {
    expect(proposeIdentityFromText(typed, [...MAKERS, "ABB"])).toEqual({ manufacturer, model });
  });

  // This PR's own plate with a comma or a rating. The catalog number's leading
  // "2080" after a comma was read as a "Micro 2080", and a rating after the
  // plate must not remove the new card either. The first two proposed on the
  // commit before the rule and nothing on the reviewed head.
  it.each([
    ["a comma between the plate's two lines", "Allen-Bradley Micro820, 2080-LC20-20QBB"],
    ["the same, and the supply voltage", "Allen-Bradley Micro820, 2080-LC20-20QBB, 24 VDC"],
    ["the plate, then the supply voltage", "Allen-Bradley Micro820 2080-LC20-20QBB, 24 VDC supply"],
    ["the plate, then input and output counts", "Allen-Bradley Micro820 2080-LC20-20QBB, 12 inputs, 8 outputs"],
    ["the plate, then its own series", "Allen-Bradley Micro820 2080-LC20-20QBB, 800 series"],
    ["the plate, then its own number", "Allen-Bradley Micro820 2080-LC20-20QBB, 820 series"],
    ["a decimal that ends in a sibling's number", "Allen-Bradley Micro820 2080-LC20-20QBB reads 12.850 on the display"],
  ])("the plate with a comma or a rating is still the Micro820: %s", (_why, typed) => {
    expect(propose(typed)).toEqual({ manufacturer: "Allen-Bradley", model: "820" });
  });

  it.each([
    ["the coil voltage", "Schneider Electric TeSys K CA3KN22BD, 24 VDC coil"],
    ["its contacts", "Schneider Electric TeSys K CA3KN22BD, 2 NO, 2 NC"],
  ])("the relay with a rating after it is still proposed: %s", (_why, typed) => {
    expect(propose(typed)).toEqual({ manufacturer: "Schneider Electric", model: "CA3KN22BD" });
  });

  // A real sibling written as a bare number beside both lines of the plate
  // ("… and 850" is a Micro850: the Micro800 family table lists it). Main
  // proposes nothing here; the commit before the rule proposed the Micro820.
  // The number is looked for anywhere in the message, not only directly after
  // the family: brackets, "the", or the plate's own catalog number in between
  // must not hide it.
  it.each([
    ["and", "Allen-Bradley Micro820 2080-LC20-20QBB and 850"],
    ["a comma", "Allen-Bradley Micro820 2080-LC20-20QBB, 850"],
    ["with words after", "Allen-Bradley Micro820 2080-LC20-20QBB and 850 both faulted"],
    ["a fault code after the number", "Allen-Bradley Micro820 2080-LC20-20QBB and 850 F1"],
    ["the catalog number in brackets", "Allen-Bradley Micro820 (2080-LC20-20QBB) and 850"],
    ["the catalog number in brackets, then a comma", "Rockwell Automation Micro820 [2080-LC20-20QBB], 830"],
    ["the family in brackets", "Allen-Bradley 2080-LC20-20QBB (Micro820) and 850"],
    ["the family in quotes", 'Allen-Bradley "Micro820" 2080-LC20-20QBB and 850'],
    ["a word before the number", "Allen-Bradley Micro820 2080-LC20-20QBB and the 850"],
    ["the sibling before the plate", "Allen-Bradley 850 and Micro820 2080-LC20-20QBB"],
    ["a slash", "Allen-Bradley Micro820/850 2080-LC20-20QBB"],
    ["further along the sentence", "Allen-Bradley Micro820 2080-LC20-20QBB, also the 830 next to it"],
    ["versus", "Allen-Bradley Micro820 2080-LC20-20QBB vs 870"],
  ])("a bare-number sibling beside both lines of the plate proposes nothing: %s", (_why, typed) => {
    expect(propose(typed)).toBeNull();
  });

  // Stated limits of the new card, each "no card", never a different machine.
  // A number a family table lists as a sibling is read as that sibling whatever
  // follows it: units and count words are not read.
  it.each([
    ["a rating whose number is a sibling's", "Allen-Bradley Micro820 2080-LC20-20QBB, 850 mA"],
    ["a count whose number is a sibling's", "Allen-Bradley Micro820 2080-LC20-20QBB, 850 inputs"],
  ])("limit: after the plate, a number that is also a sibling's gives no card: %s", (_why, typed) => {
    expect(propose(typed)).toBeNull();
  });

  // A second known maker in the message is a second machine, whatever is or is
  // not written after its name. Main proposes nothing for these wordings (the
  // new rules do not exist there); the reviewed head proposed the relay or the
  // PLC. Asked only of the proposals this change adds.
  it.each([
    ["a second maker's machine by its series number", "Siemens 2200 and Schneider Electric TeSys K CA3KN22BD"],
    ["a second maker's machine in words", "AutomationDirect drive feeds the conveyor and a Schneider Electric TeSys K CA3KN22BD"],
    ["a second maker before the plate", "The Siemens panel is fine but the Allen-Bradley Micro820 2080-LC20-20QBB faulted"],
    ["a second maker after the plate", "Allen-Bradley Micro820 2080-LC20-20QBB trips when the AutomationDirect drive on the conveyor starts"],
  ])("a second maker beside a newly proposed machine proposes nothing: %s", (_why, typed) => {
    expect(propose(typed)).toBeNull();
  });

  // A limit: the second-maker check knows only the makers the library holds.
  // A second machine from a maker that is not in it ("Dorner" is not in MAKERS)
  // is a word and a number no list knows, the same shape as "Studio 5000" or
  // "station 12", and the new card is still shown. It is main's gap (#5395)
  // on a new card. With the maker in the library the card is not shown.
  it.each([
    ["Dorner 2200 and Schneider Electric TeSys K CA3KN22BD", "Schneider Electric", "CA3KN22BD"],
    ["Dorner 2200 conveyor and the Allen-Bradley Micro820 2080-LC20-20QBB", "Allen-Bradley", "820"],
  ])("limit: a second machine from a maker the library does not hold still gets the new card: %s", (typed, manufacturer, model) => {
    expect(propose(typed)).toEqual({ manufacturer, model });
    expect(proposeIdentityFromText(typed, [...MAKERS, "Dorner"])).toBeNull();
  });

  // A second product line named by a series or range word this file's own
  // closed lists hold (SERIES_WORDS, RANGE_WORDS), with no number after it.
  it.each([
    ["another member of the relay's own range", "Schneider Electric TeSys K CA3KN22BD and TeSys D"],
    ["the same, with a noun after it", "Schneider Electric TeSys K CA3KN22BD and a TeSys D contactor"],
    ["a drive series of the same maker", "Schneider Electric TeSys K CA3KN22BD and the Altivar"],
    ["another maker's series, the maker not named", "Allen-Bradley Micro820 2080-LC20-20QBB and the SINAMICS"],
    // Series words only the closed list holds: the equipment vocabulary does not know them.
    ["a series only the closed list holds", "Allen-Bradley Micro820 2080-LC20-20QBB and the Movitrac"],
    ["the same, beside the relay", "Schneider Electric TeSys K CA3KN22BD and a DuraPulse"],
    ["the same, in brackets", "Allen-Bradley Micro820 2080-LC20-20QBB (Movitrac)"],
    ["the relay's other range member, in quotes", 'Schneider Electric TeSys K CA3KN22BD and the "TeSys D"'],
    // A limit, not a second machine: the range named again gives no card either.
    ["limit: the relay's own range named a second time", "Schneider Electric TeSys K CA3KN22BD, is the TeSys K rated for 24 VDC?"],
  ])("a second series or range name beside a newly proposed machine proposes nothing: %s", (_why, typed) => {
    expect(propose(typed)).toBeNull();
  });

  // A second product line named by a word alone that the shared equipment
  // vocabulary (equipment-type.ts) reads as a product line. The mention scan
  // already asks that vocabulary about a word followed by a number; here the
  // word stands alone.
  it.each([
    ["a drive family", "Allen-Bradley Micro820 2080-LC20-20QBB and a PowerFlex"],
    ["a servo family", "Allen-Bradley Micro820 2080-LC20-20QBB and a Kinetix"],
    ["a controller family", "Allen-Bradley Micro820 2080-LC20-20QBB and CompactLogix"],
    ["beside the relay", "Schneider Electric TeSys K CA3KN22BD and a PowerFlex"],
    ["lower case", "Allen-Bradley Micro820 2080-LC20-20QBB and a powerflex"],
    ["in brackets", "Allen-Bradley Micro820 2080-LC20-20QBB (PowerFlex)"],
    ["in quotes", 'Allen-Bradley Micro820 2080-LC20-20QBB and the "Kinetix"'],
    // A limit, not a second machine: "click" is also a controller line's name.
    ["limit: an everyday word that is also a product line's name", "I hear a click from the Schneider Electric TeSys K CA3KN22BD"],
    // Limits: the vocabulary reads these spellings of a device or protocol word
    // as a product line, and the generic-word lists hold only the plain spelling.
    ["limit: a device word in the plural", "Schneider Electric TeSys K CA3KN22BD drops out when the VFDs start"],
    ["limit: a device word joined by a hyphen", "Schneider Electric TeSys K CA3KN22BD feeds the variable-frequency drive"],
    ["limit: a protocol written with a slash", "Allen-Bradley Micro820 2080-LC20-20QBB is on EtherNet/IP"],
  ])("a second product line in a word alone beside a newly proposed machine proposes nothing: %s", (_why, typed) => {
    expect(propose(typed)).toBeNull();
  });

  // Codex round 3 on #5387 (F4): a product line the shared vocabulary names in
  // TWO words. Each word alone is an everyday one ("point", "flex", "compact",
  // "I/O"), so reading word by word never saw the line.
  it.each([
    ["POINT I/O", "Allen-Bradley Micro820 2080-LC20-20QBB and a POINT I/O rack both faulted, which manual should I use?"],
    ["FLEX I/O", "Allen-Bradley Micro820 2080-LC20-20QBB and a FLEX I/O rack both faulted, which manual should I use?"],
    ["Compact I/O", "Allen-Bradley Micro820 2080-LC20-20QBB and a Compact I/O rack both faulted, which manual should I use?"],
    ["lower case, no slash", "Allen-Bradley Micro820 2080-LC20-20QBB and the point io rack"],
    ["in brackets", "Allen-Bradley Micro820 2080-LC20-20QBB (POINT I/O)"],
    ["beside the relay", "Schneider Electric TeSys K CA3KN22BD next to the Flex I/O"],
    // A limit, not a second machine: the two words can also describe the controller's own I/O.
    ["limit: the two words about the machine's own I/O", "Allen-Bradley Micro820 2080-LC20-20QBB compact I/O fault"],
  ])("a second product line named in two words beside a newly proposed machine proposes nothing: %s", (_why, typed) => {
    expect(propose(typed)).toBeNull();
  });

  // Each of those words on its own, or beside another word, is not a product line.
  it.each([
    ["Allen-Bradley Micro820 2080-LC20-20QBB trips at the same point every cycle"],
    ["Allen-Bradley Micro820 2080-LC20-20QBB is wired through flex conduit"],
    ["Allen-Bradley Micro820 2080-LC20-20QBB is a compact controller"],
    ["Allen-Bradley Micro820 2080-LC20-20QBB I/O fault light is on"],
    ["Allen-Bradley Micro820 2080-LC20-20QBB has a point I can not reach"],
    // Two-word device phrases the vocabulary also holds are not product lines.
    ["Allen-Bradley Micro820 2080-LC20-20QBB drives a servo motor"],
    ["Allen-Bradley Micro820 2080-LC20-20QBB reads a proximity sensor and a load cell"],
    // The two words are a line only when they stand together in the sentence.
    ["Allen-Bradley Micro820 2080-LC20-20QBB at the set point, I/O looks fine"],
    ["Allen-Bradley Micro820 2080-LC20-20QBB set-point I/O looks fine"],
    ["Allen-Bradley Micro820 2080-LC20-20QBB flex cable to the I/O is loose"],
    ["Allen-Bradley Micro820 2080-LC20-20QBB point 3 of the I/O is dead"],
    // "IO-Link" is a sensor interface, not the I/O word.
    ["Allen-Bradley Micro820 2080-LC20-20QBB has a flex IO-Link master"],
  ])("control: one machine with those words used plainly is still proposed: %s", (typed) => {
    expect(propose(typed)).toEqual({ manufacturer: "Allen-Bradley", model: "820" });
  });

  // The same three lines in the other ways a technician writes them: plural,
  // joined by a hyphen, and with the line's own sub-family word in between.
  it.each([
    ["plural", "POINT I/Os"],
    ["plural with an apostrophe", "FLEX I/O's"],
    ["hyphen", "Flex-I/O"],
    ["hyphen, no slash", "Point-IO"],
    ["hyphen", "Compact-I/O"],
    ["sub-family word", "POINT Guard I/O"],
    ["sub-family word", "FLEX 5000 I/O"],
    ["sub-family word", "Compact 5000 I/O"],
    ["sub-family word", "FLEX Ex I/O"],
    ["over a line break", "POINT\nI/O"],
  ])("a two-word product line written another way proposes nothing: %s (%s)", (_why, line) => {
    expect(propose(`Allen-Bradley Micro820 2080-LC20-20QBB and a ${line} rack both faulted`)).toBeNull();
  });

  // KNOWN LIMIT, pinned so a change either way is seen. The shared vocabulary
  // has no entry for these names (or none for the spaced spelling), so a
  // second machine named this way is still missed and the card is still
  // offered. Main offers no card for any of them.
  it.each([
    ["ArmorBlock I/O"],
    ["GuardLogix"],
    ["Compact Logix"],
    ["Control Logix"],
    ["Power Flex 525"],
    ["Panel View"],
  ])("known limit: a second machine the vocabulary does not name is not seen: %s", (line) => {
    expect(propose(`Allen-Bradley Micro820 2080-LC20-20QBB and a ${line} both faulted`)).toEqual({ manufacturer: "Allen-Bradley", model: "820" });
  });

  // KNOWN LIMIT the other way: the two words standing together are read as the
  // line even when the technician means the controller's own expansion.
  it.each([
    ["Allen-Bradley Micro820 2080-LC20-20QBB with a POINT I/O expansion"],
    ["Allen-Bradley Micro820 2080-LC20-20QBB set point I/O looks fine"],
  ])("known limit: the two words together about one machine propose nothing: %s", (typed) => {
    expect(propose(typed)).toBeNull();
  });

  // The plain spelling of the device words a technician uses around ONE machine
  // is not a product line. Other spellings (plural, hyphen, slash) are the
  // limit rows above.
  it.each([
    ["Allen-Bradley Micro820 2080-LC20-20QBB will not talk to the drive", "Allen-Bradley", "820"],
    ["Allen-Bradley Micro820 2080-LC20-20QBB PLC stopped the conveyor motor", "Allen-Bradley", "820"],
    ["Allen-Bradley Micro820 2080-LC20-20QBB controller lost its Ethernet link to the HMI", "Allen-Bradley", "820"],
    ["Schneider Electric TeSys K CA3KN22BD relay drops out when the VFD starts", "Schneider Electric", "CA3KN22BD"],
    ["Schneider Electric TeSys K CA3KN22BD control relay on the servo panel", "Schneider Electric", "CA3KN22BD"],
  ])("control: one machine with everyday device words is still proposed: %s", (typed, manufacturer, model) => {
    expect(propose(typed)).toEqual({ manufacturer, model });
  });

  // A card main shows is never changed, also when the same message names the
  // machine a second time in one of the new wordings. Main's reading runs
  // first and its card is returned as it is; the new rules and their checks
  // are only reached when main's reading gives nothing. The last two rows are
  // main's own gap (#5395), unchanged.
  it.each([
    ["Schneider CA3KN22BD, plate reads Schneider Electric TeSys K CA3KN22BD", "Schneider", "CA3KN22BD"],
    ["Schneider Electric CA3KN22BD chatters. The Schneider Electric TeSys K CA3KN22BD sits beside the Altivar", "Schneider Electric", "CA3KN22BD"],
    ["Schneider Electric CA3KN22BD. Schneider Electric TeSys K CA3KN22BD and an SMC Flex", "Schneider Electric", "CA3KN22BD"],
  ])("the card main shows is returned unchanged: %s", (typed, manufacturer, model) => {
    expect(propose(typed)).toEqual({ manufacturer, model });
  });

  it("control: the maker's two names are one maker, and the plate is still proposed", () => {
    expect(propose("Allen-Bradley Micro820 2080-LC20-20QBB from Rockwell Automation")).toEqual({ manufacturer: "Allen-Bradley", model: "820" });
    expect(propose("Schneider TeSys K CA3KN22BD, the Schneider Electric one")).toEqual({ manufacturer: "Schneider", model: "CA3KN22BD" });
  });

  it("a value under a serial label is not read at all: the family alone is proposed, as before", () => {
    expect(propose("Allen-Bradley Micro820 SN: 2080-LC20-20QBB")).toEqual({ manufacturer: "Allen-Bradley", model: "820" });
  });

  it("the pairing needs BOTH lines: a catalog number with no family named beside it pairs with nothing", () => {
    expect(familyNamedWithItsCatalogNumber("Allen-Bradley", ["2080-LC20-20QBB"])).toBeNull();
    expect(familyNamedWithItsCatalogNumber("Allen-Bradley", ["Micro820"])).toBeNull();
    expect(familyNamedWithItsCatalogNumber("Allen-Bradley", ["Micro820", "2080-LC20-20QBB"])).toBe("820");
  });

  it("the automatic manual search is not widened: its own gate reads these messages as before", () => {
    const typed = "Allen-Bradley Micro820 2080-LC20-20QBB";
    expect(namesOnlyThisMachine(typed, "2080-LC20-20QBB")).toBe(false);
    expect(isSafeCandidateSearchIdentity("", typed, "2080-LC20-20QBB", "ALLEN-BRADLEY")).toBe(false);
  });

  // Review round 1 on #5387: the check above passes the catalog number as the
  // part. What the fallback actually proposes is the FAMILY, and that proposal
  // is what the chat route hands to the gate. Nothing starts the automatic
  // manual search until the technician confirms the card. Two separate checks
  // in the gate each say no (the proposed model is not the one part code in
  // the text; the text does not name only that machine), so removing either
  // one alone leaves this green: the second assertion pins the second wall.
  it.each([
    "Allen-Bradley Micro820 2080-LC20-20QBB",
    "Allen-Bradley Micro820 2080-LC20-20QBB manual please",
    "I need the manual for the Allen-Bradley Micro820 2080-LC20-20QBB",
  ])("the family it proposes does not pass the search gate either: %s", (typed) => {
    const proposed = propose(typed);
    expect(proposed).toEqual({ manufacturer: "Allen-Bradley", model: "820" });
    expect(isSafeCandidateSearchIdentity("", typed, proposed!.model, proposed!.manufacturer)).toBe(false);
    expect(namesOnlyThisMachine(typed, proposed!.model)).toBe(false);
  });
});

// ── what the proposed identity buys: the manual check can then do its job ────

const TENANT = "5e7c0000-0000-4000-8000-000000000001";
/** Cover of Rockwell publication 2080-UM005 (public). */
const MICRO820_MANUAL = {
  doc_id: "5e7c0000-0000-4000-8000-0000000000a1",
  filename: "2080-um005_-en-e.pdf",
  document_heading: "User Manual Original Instructions\nMicro820 Programmable\nControllers\nCatalog Numbers 2080-LC20-20QWB, 2080-L20E-20QWB,\n2080-LC20-20QBB, 2080-L20E-20QBB",
};
/** A sibling controller's manual. Synthetic heading, not a quotation. */
const SIBLING_MANUAL = {
  doc_id: "5e7c0000-0000-4000-8000-0000000000b2",
  filename: "sibling-controller.pdf",
  document_heading: "Micro850 Programmable Controllers User Manual",
};

/** Cover of the AutomationDirect GS10 user manual (public). */
const GS10_MANUAL = {
  doc_id: "5e7c0000-0000-4000-8000-0000000000c3",
  filename: "gs10usermanual.pdf",
  document_heading: "DURApulse GS10 Drive User Manual\nGS10_UMW\nOriginal Instructions",
};
/** Another drive family's manual. Synthetic heading, not a quotation. */
const OTHER_DRIVE_MANUAL = {
  doc_id: "5e7c0000-0000-4000-8000-0000000000d4",
  filename: "other-drive.pdf",
  document_heading: "GS20 AC Drive User Manual",
};

async function citedFor(model: string, manuals: Array<typeof MICRO820_MANUAL>, manufacturer = "Allen-Bradley"): Promise<string[]> {
  const rows = manuals.map((m, i) => ({
    ...m,
    source_url: `https://test.invalid/${m.filename}`,
    source_page: 40 + i,
    page_start: 40 + i,
    page_label: String(40 + i),
    // A stand-in passage, not a quotation from either manual.
    content: "Controller status indicators. The fault indicator shows the controller fault state.",
    rank: 0.8 - i * 0.01,
  }));
  let offered = 0;
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("WITH ORDINALITY") || sql.includes("names_document")
      || sql.includes("quote_literal(lex)")
      || /^\s*(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)\b/.test(sql)) {
      return { rows: [] };
    }
    offered++;
    return { rows };
  });
  const question = "What does the red fault light mean?";
  const hits = await retrieveNodeChunks({ query } as unknown as PoolClient, TENANT, question, {
    nodeId: "synthetic-technician-typed-machine",
    unsPath: null,
    docIds: manuals.map((m) => m.doc_id),
    approvedSourceDocIds: manuals.map((m) => m.doc_id),
    validatedDocScope: true,
    rawQuery: question,
    topK: 6,
    identity: { manufacturer, model },
    identityStatus: "user_confirmed" as const,
  });
  expect(offered, "the real admission step received the candidates").toBeGreaterThan(0);
  return hits.map((h) => h.docId ?? "").sort();
}

describe("after the technician confirms what was proposed", () => {
  beforeEach(() => {
    vi.stubEnv("MIRA_ENFORCE_APPROVED_RETRIEVAL", "true");
    vi.stubEnv("NOTEBOOK_HYBRID_RETRIEVAL", "0");
    vi.stubEnv("NOTEBOOK_RERANK", "0");
    vi.stubEnv("NOTEBOOK_LEXICAL_V2", "0");
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No provider/network in this fixture"); }));
  });
  afterEach(() => {
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("the proposed identity is the one this message produces", () => {
    expect(propose("Allen-Bradley Micro820 2080-LC20-20QBB")?.model).toBe("820");
  });

  it("answers from the Micro820 manual and not from the sibling's", async () => {
    expect(await citedFor("820", [MICRO820_MANUAL, SIBLING_MANUAL])).toEqual([MICRO820_MANUAL.doc_id]);
  });

  it("refuses when only the sibling's manual is attached", async () => {
    expect(await citedFor("820", [SIBLING_MANUAL])).toEqual([]);
  });

  // Why the family is proposed and not the catalog number: the SAME plate,
  // bound by its catalog number, is not protected today. A known defect
  // (#5369), written with the correct expectation: this row turns red the day
  // it is fixed, and the mark comes off then.
  it("contrast, reached admission: bound by catalog number, its own manual is cited", async () => {
    expect(await citedFor("2080-LC20-20QBB", [MICRO820_MANUAL])).toEqual([MICRO820_MANUAL.doc_id]);
  });
  it.fails("contrast (#5369): bound by catalog number, the sibling's manual should not be cited", async () => {
    expect(await citedFor("2080-LC20-20QBB", [MICRO820_MANUAL, SIBLING_MANUAL])).toEqual([MICRO820_MANUAL.doc_id]);
  });

  // The drive's plate reads GS11N-20P2; typed, it was already proposed (as the
  // series "GS11N"). The same outcome check, so all three garage parts have one.
  it("the drive: what its typed plate proposes is answered from the GS10 manual, not another family's", async () => {
    const proposed = propose("AutomationDirect GS11N-20P2 trips on acceleration");
    expect(proposed).toEqual({ manufacturer: "AutomationDirect", model: "GS11N" });
    expect(await citedFor(proposed!.model, [GS10_MANUAL, OTHER_DRIVE_MANUAL], proposed!.manufacturer)).toEqual([GS10_MANUAL.doc_id]);
    expect(await citedFor(proposed!.model, [OTHER_DRIVE_MANUAL], proposed!.manufacturer)).toEqual([]);
  });
});
