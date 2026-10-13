import { describe, it, expect } from "vitest";
import { groupAlarmRecords, parseAlarmRecord, parseDesignations, timeSeconds, type AlarmRecord } from "./alarm-line";
import { SCREEN_FAIL_SAFE, SCREEN_NEGATIVE, SCREEN_RTD } from "./alarm-screens.fixture";

const rec = (text: string, extra: Partial<AlarmRecord> = {}): AlarmRecord => ({
  lines: [text], number: null, time: null, date: null, status: null, text, count: 1, ...extra,
});

describe("groupAlarmRecords", () => {
  it("keeps every listed row when asked not to collapse", () => {
    const rows = groupAlarmRecords(SCREEN_FAIL_SAFE, { collapse: false });
    expect(rows).toHaveLength(10);
    expect(rows.every((r) => r.count === 1)).toBe(true);
  });
  it("joins wrapped lines into records, drops the header, collapses duplicates (fail-safe screen)", () => {
    const records = groupAlarmRecords(SCREEN_FAIL_SAFE);
    expect(records.map((r) => [r.number, r.text, r.count])).toEqual([
      ["40", "Error: Wire break on Output channel 1 =y.CTL+07-K4.1 / =y.CTL+07-K4.1-2.", 2],
      ["46", "Error: Safety program: F-I/O channel passivated F-runtime group 1 Start address of the F-I/O: 61…", 2],
      ["40", "Error: Wire break on Output channel 5 =y.CTL+07-K4.1 / =y.CTL+07-K4.1-2.", 2],
      ["46", "Error: Safety program: F-I/O channel passivated F-runtime group 1 Start address of the F-I/O: 62…", 2],
      ["40", "Error: Wire break on Output channel 4 =y.CTL+07-K4.1 / =y.CTL+07-K4.1-6.", 2],
    ]);
  });
  it("captures number, cut-off time, date and status", () => {
    const [first] = groupAlarmRecords(SCREEN_FAIL_SAFE);
    expect(first.time).toEqual({ text: "08:14:3…", truncated: true });
    expect(first.date).toEqual({ text: "03/02/2027", truncated: false });
    expect(first.status).toBe("I");
    expect(first.lines).toHaveLength(2);
  });
  it("keeps a three-line record's lines and a full time", () => {
    const records = groupAlarmRecords(SCREEN_RTD);
    expect(records[0].time).toEqual({ text: "06:02:19", truncated: false });
    expect(records.find((r) => r.number === "7")?.status).toBe("IO");
  });
  it("starts a record on a message word with no row prefix", () => {
    const records = groupAlarmRecords(["Error: Wire break on Output channel 2", "=y.CTL+07-K4.1-2."]);
    expect(records).toHaveLength(1);
    expect(records[0].number).toBeNull();
    expect(records[0].text).toBe("Error: Wire break on Output channel 2 =y.CTL+07-K4.1-2.");
  });
  it("treats '...' like '…' as a cut-off marker", () => {
    expect(groupAlarmRecords(["40 08:14:3... 03/02/2027 I Error: x"])[0].time).toEqual({ text: "08:14:3...", truncated: true });
  });
  it("normalizes column pipes to spaces", () => {
    expect(groupAlarmRecords(["40 | 08:14:31 | 03/02/2027 | I | Error: x =y.CTL+07-K4.1-2."])[0].text)
      .toBe("Error: x =y.CTL+07-K4.1-2.");
  });
  it("produces no record from ordinary screen text", () => {
    expect(groupAlarmRecords(SCREEN_NEGATIVE)).toEqual([]);
  });
});

describe("parseDesignations", () => {
  it("parses track, function, location and device; trailing sentence dot excluded", () => {
    expect(parseDesignations("=y.CTL+07-K4.1 / =y.CTL+07-K4.1-2.")).toEqual([
      { raw: "=y.CTL+07-K4.1", track: "=y.", func: "CTL", location: "+07", device: "-K4.1" },
      { raw: "=y.CTL+07-K4.1-2", track: "=y.", func: "CTL", location: "+07", device: "-K4.1-2" },
    ]);
  });
  it("keeps unreadable characters as read", () => {
    expect(parseDesignations("=y.C?L+07-K4.1-2.")[0].raw).toBe("=y.C?L+07-K4.1-2");
  });
  it("needs a location or device — a bare track is not a designation", () => {
    expect(parseDesignations("value =1.HYD only")).toEqual([]);
  });
});

describe("parseAlarmRecord", () => {
  it("output wire break: kind, channel, most specific designation first", () => {
    const l = parseAlarmRecord(rec("Error: Wire break on Output channel 3 =y.CTL+07-K4.1 / =y.CTL+07-K4.1-2."))!;
    expect(l.kind).toBe("io_diagnostic");
    expect(l.diagnostic).toBe("wire_break");
    expect(l.channel).toEqual({ io: "output", number: 3 });
    expect(l.designations[0].raw).toBe("=y.CTL+07-K4.1-2");
  });
  it("input wire break", () => {
    const l = parseAlarmRecord(rec("Error: Wire break on Input channel 0 =2.ANA+03-A1.4-1."))!;
    expect(l.channel).toEqual({ io: "input", number: 0 });
  });
  it("passivation: F-group and a cut-off address, no designation needed", () => {
    const l = parseAlarmRecord(rec("Error: Safety program: F-I/O channel passivated F-runtime group 1 Start address of the F-I/O: 61…"))!;
    expect(l.kind).toBe("safety_passivation");
    expect(l.fGroup).toBe("1");
    expect(l.fAddress).toEqual({ text: "61…", truncated: true });
  });
  it("temperature too high with a subject", () => {
    const l = parseAlarmRecord(rec("Error: Temperature measurement RIGHT WINDING too high =1.HYD+04-TE3"))!;
    expect([l.kind, l.quantity, l.direction, l.subject]).toEqual(["measurement_limit", "temperature", "high", "RIGHT WINDING"]);
    expect(l.value).toEqual({ shown: false, reason: "not_displayed" });
  });
  it("German temperature too low", () => {
    const l = parseAlarmRecord(rec("Fehler: Temperaturmessung LINKS zu niedrig =1.HYD+04-TE2"))!;
    expect([l.kind, l.quantity, l.direction]).toEqual(["measurement_limit", "temperature", "low"]);
  });
  it("zero value against zero limit means the reading is not on this view", () => {
    const l = parseAlarmRecord(rec("Error: Temperature measurement LEFT WINDING too high =1.HYD+04-TE2 value 0 limit 0"))!;
    expect(l.value).toEqual({ shown: false, reason: "zero_and_zero_limit" });
  });
  it("a shown value and limit", () => {
    const l = parseAlarmRecord(rec("Error: Temperature measurement LEFT WINDING too high =1.HYD+04-TE2 value 132.5 °C limit 120 °C"))!;
    expect(l.value).toEqual({ shown: true, number: 132.5, unit: "°C" });
    expect(l.limit).toEqual({ number: 120, unit: "°C" });
  });
  it("an unreadable value is never parsed as a number", () => {
    const l = parseAlarmRecord(rec("Error: Temperature measurement LEFT WINDING too high =1.HYD+04-TE2 value 1?2.5 °C"))!;
    expect(l.value).toEqual({ shown: false, reason: "unreadable" });
  });
  it("a cut-off value is never completed", () => {
    const l = parseAlarmRecord(rec("Error: Temperature measurement LEFT WINDING too high =1.HYD+04-TE2 value 13… °C"))!;
    expect(l.value).toEqual({ shown: false, reason: "truncated" });
  });
  it("overrange and switch trip are recognized kinds", () => {
    expect(parseAlarmRecord(rec("Error: Overrange on Input channel 2 =1.HYD+04-A2.1-3."))!.diagnostic).toBe("overrange");
    expect(parseAlarmRecord(rec("Error: Thermal switch tripped =1.HYD+04-BT1"))!.kind).toBe("switch_trip");
  });
  it("returns null without an identifier", () => {
    expect(parseAlarmRecord(rec("Error: Wire break on Output channel 3"))).toBeNull();
    expect(parseAlarmRecord(rec("Error: Safety program: F-I/O channel passivated"))).toBeNull();
  });
  it("returns null for an unrecognized message", () => {
    expect(parseAlarmRecord(rec("Warning: Automatic stop"))).toBeNull();
    expect(parseAlarmRecord(rec("Error: E-stop reset required =1.HYD+04-S1"))).toBeNull();
  });
});

describe("timeSeconds", () => {
  it("parses only a full hh:mm:ss", () => {
    expect(timeSeconds("06:02:17")).toBe(6 * 3600 + 2 * 60 + 17);
    expect(timeSeconds("08:14:3…")).toBeNull();
    expect(timeSeconds("08:14")).toBeNull();
  });
});
