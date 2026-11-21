# Safety-note check, blog queue Oct 27 to Nov 2 (T-059)

- Date: Oct 27, 2026. List only. **No post was edited and nothing was posted.**
- The rule checked here (back up first, follow the OEM procedure, get site approval, and de-energize/lockout before electrical work, per issue #4858) came to Content Studio through Grok Bot. Mike hasn't confirmed it in his own words yet.
- Scope: the 7 posts in `blog/queue/` dated 2026-10-27 to 2026-11-02. Backup (.bak*) files were not read.
- Suggested lines only point readers to their own backup, the OEM manual and their site procedure. They add no safety content beyond the cited manuals and make no product claims. Every suggestion needs a Search Steward recheck before it goes into a post.

## Gaps

| # | Post file | Line | Step (short quote) | Missing note parts | Suggested one-line addition |
|---|---|---|---|---|---|
| 1 | 2026-10-27-micro820-flashing-red-fault-clear.md | 140-141 | "In the **root** of the card, create `ConfigMeFirst.txt`" / "Add the line `[CF]`" (card in, power cycle to attempt a clear) | Back up first. The OEM and site approval parts are covered at L136 and L163. Lockout doesn't apply, since there's no wiring. | "Back up the controller project and record the fault details before you insert the card or power cycle." |
| 2 | 2026-10-29-tp700-comfort-touch-calibration.md | 122-128 | "Open the **Control Panel** ... Press **Recalibrate**" (changes panel settings on a running HMI) | Site approval and the OEM-procedure reminder. Backup doesn't apply, since the old setting is kept if not confirmed (p.92). Lockout doesn't apply. | "Get your site's approval before changing panel settings on a running machine, and follow the procedure in the panel's operating instructions." |
| 3 | 2026-10-29-tp700-comfort-touch-calibration.md | 136-140 | "plug a mouse into the USB port" (connecting a device to a live panel) | Site approval and the OEM-procedure reminder | "Connect a USB device only as the operating instructions allow (p.175) and with your site's approval." |
| 4 | 2026-10-31-micro820-analog-input-as-discrete.md | 141-142 | "A device on I-00 to I-03 has to be wired as a sinking input" (rewiring field inputs) | De-energize/lockout. The OEM and site parts are covered at L104 and the closing publisher's note. Get approval is implied by "site's approved procedure". | "De-energize and lock out per your site's procedure before you change any wiring." |
| 5 | 2026-11-01-powerflex-525-overload-motor-nameplate.md | 124-129 | "**P031 [Motor NP Volts]** ... Stop drive before changing this parameter" (changing parameters P031 to P036) | Back up first and site approval. OEM is covered by the quoted manual text. Lockout doesn't apply, since this is keypad or software work (L92). | "Record the current parameter values and get your site's approval before you change them." |
| 6 | 2026-11-01-powerflex-525-overload-motor-nameplate.md | 136-142 | "**P040 [Autotune]** ... dynamic (motor spinning)" (running autotune) | Site approval to run it. The OEM warning and the site load procedure are covered at L142. Backup is covered by row 5 if that line is added. | "Run autotune only with your site's approval and per the OEM procedure on p.86." |

## Checked, no gap

| Post file | Line | Step | Why covered |
|---|---|---|---|
| 2026-10-28-s7-1200-reset-to-factory-settings.md | 113, 120, 170 | Reset to factory settings; lost-password recovery | L113 has back up, the Siemens procedure and site approval. L120 covers machine state. There's no electrical work. |
| 2026-10-30-powerflex-525-f004-f005-undervoltage-overvoltage.md | 96, 147, 163-165 | Clearing faults, restart, supply or terminal checks | L96 covers p.13 and site procedure and qualified personnel. L147 says find the cause first and follow the approved restart procedure. L165 points to the site lockout procedure. A parameter backup isn't needed, since nothing is changed. |
| 2026-11-02-s7-1200-hmi-shows-hashes.md | 92, 121, 143 | Reseating or reconnecting cables | L92 and L121 cover the site procedure and qualified personnel. L143 covers the site lockout procedure and the panel's operating instructions. |

## Count

- Total gaps: 6
- 10-27: 1. 10-28: 0. 10-29: 2. 10-30: 0. 10-31: 1. 11-01: 2. 11-02: 0.
