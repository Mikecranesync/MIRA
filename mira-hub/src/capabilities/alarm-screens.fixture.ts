/**
 * Synthetic HMI alarm screens. Invented designations, addresses, dates and times
 * only (Mike 2026-10-12: no customer text in the repo). The LAYOUT copies what real
 * screens do: column header, entries wrapped over two or three lines, cut-off time
 * and address columns, every alarm listed twice.
 */
export const SCREEN_FAIL_SAFE: readonly string[] = [
  "No. Time Date Status Text",
  "40 08:14:3… 03/02/2027 I Error: Wire break on Output channel 1",
  "=y.CTL+07-K4.1 / =y.CTL+07-K4.1-2.",
  "46 08:14:3… 03/02/2027 I Error: Safety program: F-I/O channel passivated",
  "F-runtime group 1",
  "Start address of the F-I/O: 61…",
  "40 08:14:3… 03/02/2027 I Error: Wire break on Output channel 5",
  "=y.CTL+07-K4.1 / =y.CTL+07-K4.1-2.",
  "46 08:14:3… 03/02/2027 I Error: Safety program: F-I/O channel passivated",
  "F-runtime group 1",
  "Start address of the F-I/O: 61…",
  "40 08:14:3… 03/02/2027 I Error: Wire break on Output channel 1",
  "=y.CTL+07-K4.1 / =y.CTL+07-K4.1-2.",
  "40 08:14:3… 03/02/2027 I Error: Wire break on Output channel 5",
  "=y.CTL+07-K4.1 / =y.CTL+07-K4.1-2.",
  "46 08:14:3… 03/02/2027 I Error: Safety program: F-I/O channel passivated",
  "F-runtime group 1",
  "Start address of the F-I/O: 62…",
  "40 08:14:3… 03/02/2027 I Error: Wire break on Output channel 4",
  "=y.CTL+07-K4.1 / =y.CTL+07-K4.1-6.",
  "46 08:14:3… 03/02/2027 I Error: Safety program: F-I/O channel passivated",
  "F-runtime group 1",
  "Start address of the F-I/O: 62…",
  "40 08:14:3… 03/02/2027 I Error: Wire break on Output channel 4",
  "=y.CTL+07-K4.1 / =y.CTL+07-K4.1-6.",
];

/** Same alarms, newest-first list where a passivation happens to be on top. */
export const SCREEN_FAIL_SAFE_PASSIVATION_FIRST: readonly string[] = [
  "46 08:14:3… 03/02/2027 I Error: Safety program: F-I/O channel passivated",
  "F-runtime group 1",
  "Start address of the F-I/O: 61…",
  "40 08:14:3… 03/02/2027 I Error: Wire break on Output channel 1",
  "=y.CTL+07-K4.1 / =y.CTL+07-K4.1-2.",
];

export const SCREEN_PASSIVATION_ONLY: readonly string[] = [
  "46 09:01:07 03/02/2027 I Error: Safety program: F-I/O channel passivated",
  "F-runtime group 2",
  "Start address of the F-I/O: 70…",
];

/** RIGHT is on top but LEFT came in first; LEFT's view prints value 0 against limit 0. */
export const SCREEN_RTD: readonly string[] = [
  "No. Time Date Status Text",
  "113 06:02:19 11/05/2027 I Error: Temperature measurement RIGHT WINDING too high",
  "=1.HYD+04-TE3",
  "112 06:02:17 11/05/2027 I Error: Temperature measurement LEFT WINDING too high",
  "=1.HYD+04-TE2 value 0 limit 0",
  "9 06:02:20 11/05/2027 I Warning: Automatic stop",
  "7 06:01:58 11/05/2027 IO Error: E-stop reset required",
];

export const SCREEN_NEGATIVE: readonly string[] = [
  "Main menu",
  "Recipes",
  "Diagnostics",
  "Part no. 6ES7 523-1BL00",
  "Operator: shift B",
  "12:00",
  "Language: English",
];

export const SCREEN_UNCOVERED_ONLY: readonly string[] = [
  "21 10:00:01 11/05/2027 I Error: Overrange on Input channel 2",
  "=1.HYD+04-A2.1-3.",
];

/**
 * Date-first alarm-history layout: "Event Time Display Path Name Label". One line per
 * record, no wrapping, newest-first. The RTD alarm appears three times with garbled
 * degree signs (Â°C, Â, A°C) — the middle one prints 0 against a limit of 0, and the
 * earliest (05:58:02) is the real first-out, reading on the safe side of its limit.
 */
export const SCREEN_HISTORY: readonly string[] = [
  "Event Time Display Path Name Label",
  "11/05/2027 06:02:19 Line2 525 =k.TBR+05-BT3 temperature measurement LEFT COIL too high (88Â°C, limit is 70Â°C)",
  "11/05/2027 06:01:40 Line2 525 =k.TBR+05-BT3 temperature measurement LEFT COIL too high (0Â, A°C, limit is 0Â, A°C)",
  "11/05/2027 05:58:02 Line2 525 =k.TBR+05-BT3 temperature measurement LEFT COIL too high (0°C, limit is 70°C)",
  "11/05/2027 05:40:11 Line1 589 =k.TBR+QM1-Meas resistance measurement COIL PHASE V too high (1 Ohm, limit is 1 Ohm)",
  "11/05/2027 05:39:58 Line2 661 =k.HP2+00-AS AUTOMATIC START automatic stop",
  "11/05/2027 05:39:58 Line2 842 =k.HP2+82.09-B15-C proximity switch DOOR CLOSED not flagged",
];
