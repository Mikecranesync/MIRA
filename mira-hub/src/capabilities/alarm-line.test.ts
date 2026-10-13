import { describe, it, expect } from "vitest";
import { groupAlarmRecords, parseAlarmRecord, parseDesignations, timeSeconds, isHistoryRecord, type AlarmRecord } from "./alarm-line";
import { SCREEN_FAIL_SAFE, SCREEN_NEGATIVE, SCREEN_RTD, SCREEN_HISTORY } from "./alarm-screens.fixture";

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
  it("the same alarm on two different dates stays two records", () => {
    const records = groupAlarmRecords([
      "40 23:59:58 03/02/2027 I Error: Wire break on Output channel 1", "=y.CTL+07-K4.1-2.",
      "40 00:00:03 03/03/2027 I Error: Wire break on Output channel 1", "=y.CTL+07-K4.1-2.",
    ]);
    expect(records.map((r) => [r.date?.text, r.count])).toEqual([["03/02/2027", 1], ["03/03/2027", 1]]);
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
  it("passivation fields are recognized whatever their case", () => {
    const l = parseAlarmRecord(rec("error: safety program: f-i/o channel passivated f-runtime group 1 start address of the f-i/o: 61…"))!;
    expect(l).not.toBeNull();
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
  // A reading in a form the parser does not know is still ON the line: "unrecognized", never
  // "not_displayed" — the card must not tell a technician the screen hides a value it shows.
  it.each([
    "Error: Temperature measurement LEFT WINDING too high =1.HYD+04-TE2 (115 °C, limit is 70 °C)",
    "Error: Temperature measurement LEFT WINDING too high =1.HYD+04-TE2 (0Â°C, limit is 0Â°C)",
    "Error: Resistance measurement BRAKE COIL PHASE V too high =1.HYD+04-TE7 (1.317 Ohm, limit is 1.300 Ohm)",
  ])("a reading in an unparsed form is unrecognized: %s", (text) => {
    const l = parseAlarmRecord(rec(text))!;
    expect(l.kind).toBe("measurement_limit");
    expect(l.value).toEqual({ shown: false, reason: "unrecognized" });
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

describe("groupAlarmRecords — date-first history layout", () => {
  it("drops the header and produces one record per row, path and name kept off the quoted text", () => {
    const records = groupAlarmRecords(SCREEN_HISTORY);
    expect(records).toHaveLength(6);
    const first = records[0];
    expect(first.date).toEqual({ text: "11/05/2027", truncated: false });
    expect(first.time).toEqual({ text: "06:02:19", truncated: false });
    // Columns are Display Path | Name | Label: the Label carries the device tag, and the
    // quote a technician reads must keep it.
    expect(first.path).toBe("Line2");
    expect(first.name).toBe("525");
    expect(first.text).toBe("=k.TBR+05-BT3 temperature measurement LEFT COIL too high (88Â°C, limit is 70Â°C)");
    expect(first.text).not.toContain("Line2");
    expect(first.text).not.toContain("525");
  });
  it("a history row's designation comes from its label, so the card quote keeps the device tag", () => {
    const l = parseAlarmRecord(groupAlarmRecords(SCREEN_HISTORY)[0])!;
    expect(l.designations.map((d) => d.raw)).toEqual(["=k.TBR+05-BT3"]);
  });
  it("isHistoryRecord is true only for a row carrying path/name", () => {
    const [history] = groupAlarmRecords(SCREEN_HISTORY);
    expect(isHistoryRecord(history)).toBe(true);
    const [standard] = groupAlarmRecords(SCREEN_FAIL_SAFE);
    expect(isHistoryRecord(standard)).toBe(false);
  });
  it("the existing row-prefix layout is unaffected by the new date-first branch", () => {
    const records = groupAlarmRecords(SCREEN_FAIL_SAFE);
    expect(records.map((r) => [r.number, r.text, r.count])).toEqual([
      ["40", "Error: Wire break on Output channel 1 =y.CTL+07-K4.1 / =y.CTL+07-K4.1-2.", 2],
      ["46", "Error: Safety program: F-I/O channel passivated F-runtime group 1 Start address of the F-I/O: 61…", 2],
      ["40", "Error: Wire break on Output channel 5 =y.CTL+07-K4.1 / =y.CTL+07-K4.1-2.", 2],
      ["46", "Error: Safety program: F-I/O channel passivated F-runtime group 1 Start address of the F-I/O: 62…", 2],
      ["40", "Error: Wire break on Output channel 4 =y.CTL+07-K4.1 / =y.CTL+07-K4.1-6.", 2],
    ]);
  });
});

describe("parseAlarmRecord — history-layout readings in parentheses", () => {
  it.each([
    ["(88Â°C, limit is 70Â°C)", 70, "°C"],
    ["(0°C, limit is 70°C)", 70, "°C"],
    ["(1 Ohm, limit is 1 Ohm)", 1, "Ohm"],
  ])("parses the limit M and unit out of %s regardless of the unit spelling", (paren, m, unit) => {
    const records = groupAlarmRecords([
      "Event Time Display Path Name Label",
      `11/05/2027 06:02:19 Line2 525 =k.TBR+05-BT3 temperature measurement LEFT COIL too high ${paren}`,
    ]);
    const l = parseAlarmRecord(records[0])!;
    expect(l.limit).toEqual({ number: m, unit });
  });

  it("N==0 and M==0 is the existing zero_and_zero_limit reason, garbled degree sign (Â°C)", () => {
    const records = groupAlarmRecords([
      "Event Time Display Path Name Label",
      "11/05/2027 06:01:40 Line2 525 =k.TBR+05-BT3 temperature measurement LEFT COIL too high (0Â, A°C, limit is 0Â, A°C)",
    ]);
    const l = parseAlarmRecord(records[0])!;
    expect(l.value).toEqual({ shown: false, reason: "zero_and_zero_limit" });
    expect(l.limit).toEqual({ number: 0, unit: "°C" });
  });

  it("N==0 and M==0 with the Ã, Â°C garble form also parses", () => {
    const records = groupAlarmRecords([
      "Event Time Display Path Name Label",
      "11/05/2027 06:01:40 Line2 525 =k.TBR+05-BT3 temperature measurement LEFT COIL too high (0Ã, Â°C, limit is 0Ã, Â°C)",
    ]);
    const l = parseAlarmRecord(records[0])!;
    expect(l.value).toEqual({ shown: false, reason: "zero_and_zero_limit" });
  });

  it("direction high and N<M contradicts the alarm (reading on the safe side)", () => {
    const records = groupAlarmRecords([
      "Event Time Display Path Name Label",
      "11/05/2027 05:58:02 Line2 525 =k.TBR+05-BT3 temperature measurement LEFT COIL too high (0°C, limit is 70°C)",
    ]);
    const l = parseAlarmRecord(records[0])!;
    expect(l.value).toEqual({ shown: false, reason: "contradicts_alarm" });
    expect(l.limit).toEqual({ number: 70, unit: "°C" });
  });

  it("direction low and N>M also contradicts the alarm", () => {
    const records = groupAlarmRecords([
      "Event Time Display Path Name Label",
      "11/05/2027 05:58:02 Line2 525 =k.TBR+05-BT3 temperature measurement LEFT COIL too low (90°C, limit is 70°C)",
    ]);
    const l = parseAlarmRecord(records[0])!;
    expect(l.value).toEqual({ shown: false, reason: "contradicts_alarm" });
  });

  it("N==M with a direction is the rounded reason", () => {
    const records = groupAlarmRecords([
      "Event Time Display Path Name Label",
      "11/05/2027 05:58:02 Line2 525 =k.TBR+05-BT3 temperature measurement LEFT COIL too high (70°C, limit is 70°C)",
    ]);
    const l = parseAlarmRecord(records[0])!;
    expect(l.value).toEqual({ shown: false, reason: "rounded" });
  });

  it("otherwise the value is shown, with its unit, even through a garbled degree sign", () => {
    const records = groupAlarmRecords([
      "Event Time Display Path Name Label",
      "11/05/2027 06:02:19 Line2 525 =k.TBR+05-BT3 temperature measurement LEFT COIL too high (88Â°C, limit is 70Â°C)",
    ]);
    const l = parseAlarmRecord(records[0])!;
    expect(l.value).toEqual({ shown: true, number: 88, unit: "°C" });
    expect(l.limit).toEqual({ number: 70, unit: "°C" });
  });

  it("the exact same reading text keeps the OLD unrecognized behaviour on the standard layout", () => {
    // Same parenthetical shape as the history-layout tests above, fed through the
    // existing row-prefix layout (no date-first match): the existing behaviour from
    // #4392 must not change.
    const l = parseAlarmRecord({
      lines: [], number: null, time: null, date: null, status: null, count: 1,
      text: "Error: Temperature measurement LEFT COIL too high =1.HYD+04-TE2 (70°C, limit is 70°C)",
    })!;
    expect(l.value).toEqual({ shown: false, reason: "unrecognized" });
  });

  it("an unparseable leftover (no , limit is structure) stays unrecognized on a history record", () => {
    const records = groupAlarmRecords([
      "Event Time Display Path Name Label",
      "11/05/2027 06:02:19 Line2 525 =k.TBR+05-BT3 temperature measurement LEFT COIL too high (115 °C only)",
    ]);
    const l = parseAlarmRecord(records[0])!;
    expect(l.value).toEqual({ shown: false, reason: "unrecognized" });
  });
});
