# Safety-line recheck, T-060 (Oct 27, 2026)

List only. No post was edited. Input: blog/safety-note-check-2026-10-27.md (T-059). Manuals read with pdftotext: Micro820 2080-UM005H-EN-E, Comfort Panels A5E36770603-AE (07/2022), PF525 520-UM001O-EN-E. Plus manuals/safety-deenergize-quotes-2026-10-27.md. None of these manuals says "lockout/tagout", so any lockout wording points to the site procedure.

| # | Post / line | Suggested line | Verdict | Replacement wording | Reason / page checked |
|---|---|---|---|---|---|
| 1 | 10-27 Micro820, L140-141 | "Back up the controller project and record the fault details before you insert the card or power cycle." | **Reword** | "Make sure you have a copy of the controller project, and record the fault details in CCW (p.155), before you insert the card or power cycle." | p.120 says a card backup on a faulted controller needs "extra power cycle to clear existing fault first using [CF]", so "back up the controller project" at this point could send readers to do a card backup the manual says won't work yet. The new wording asks for an existing copy and points to the post's own CCW fault-record step (p.155). |
| 2 | 10-29 TP700, L122-128 | "Get your site's approval before changing panel settings on a running machine, and follow the procedure in the panel's operating instructions." | **OK** | — | It invents no procedure. The steps match §4.3.5.6, pp.91-92. p.92 confirms "your original setting will be retained" if you don't confirm, so a backup isn't needed. |
| 3 | 10-29 TP700, L136-140 | "Connect a USB device only as the operating instructions allow (p.175) and with your site's approval." | **Reword** | "Connect a USB device only as the operating instructions describe (USB notes, p.55) and with your site's approval." | Wrong page. p.175 only lists the "External mouse, connected via USB" as an input option and sets no connection rules. The USB connection notes are on p.55: ground a self-powered device, don't overload the port, and use a USB cable of 1.5 m or less. |
| 4 | 10-31 Micro820 analog, L141-142 | "De-energize and lock out per your site's procedure before you change any wiring." | **Reword** | "Before you change any wiring, disconnect power to the controller system, as the manual says (p.37), and lock out per your site's lockout procedure." | The original is acceptable on lockout because it already points to the site. The reword adds the manual's own words: "Before you install and wire any device, disconnect power to the controller system" (p.37). p.27 also says to de-energize other power sources. Lockout is not attributed to the manual. |
| 5 | 11-01 PF525, L124-129 | "Record the current parameter values and get your site's approval before you change them." | **OK** | — | It invents no procedure, and the manual's own "Stop drive before changing this parameter" note is already quoted in the post for P031, P032 and P036 (pp.84-85). |
| 6 | 11-01 PF525, L136-142 | "Run autotune only with your site's approval and per the OEM procedure on p.86." | **Reword** | "Run autotune only with your site's approval. The manual says to set all Basic Program motor parameters first, and recommends disconnecting the motor from the load before proceeding (p.86)." | The page is right, but "the OEM procedure" is vague. p.86 gives no step-by-step procedure, only an IMPORTANT note ("All motor parameters in the Basic Program group must be set before running the routine") and an ATTENTION note (disconnect the motor from the load). The reword paraphrases both. |

## Count
- OK: 2 (rows 2, 5)
- Reword: 4 (rows 1, 3, 4, 6)
- Drop: 0

All replacements stay in plain English. They contain no competitor names, no prices and no MIRA result claims. Content Studio owns the final wording, and Mike hasn't yet confirmed the #4858 rule in his own words.

## Recheck after apply (Oct 27, 2026)

Diffed each post against *.bak-safety-2026-10-27. The only changes are the six added lines plus blank-line spacing. No front-matter lines changed.

| # | Post / line | Match | Result |
|---|---|---|---|
| 1 | 10-27 L140 | Exact reword | PASS |
| 2 | 10-29 L122 | Exact original (OK) | PASS |
| 3 | 10-29 L140 | Exact reword | PASS |
| 4 | 10-31 L141 | Exact reword | PASS |
| 5 | 11-01 L124 | Exact original (OK) | PASS |
| 6 | 11-01 L141 | Exact reword | PASS, but trim (a) |

**(a) 11-01 autotune (L141): trim.** Its second sentence repeats L138 (Basic Program parameters, p.86) and L140 (disconnect the motor from the load, p.86) word for word in meaning. New wording: "- Run autotune only with your site's approval." This is a cleanup, not a fail.

**(b) 10-29 USB line (L140): keep where it is.** It qualifies the manual's mouse option (p.175/176) in the paragraph just above it, and readers see the caution before the forum's "plug a mouse in" advice. Moving it after the quote would put it after the instruction it qualifies.

**Post checks (all 4 posts):** no competitor names, no prices, no MIRA result claims in public copy (MIRA appears only in internal front-matter fields that were already reviewed), closing is the contact-only "Talk to Mike" line, and the front matter is unchanged. Status stays approved on all four posts, so no new backups were needed.
