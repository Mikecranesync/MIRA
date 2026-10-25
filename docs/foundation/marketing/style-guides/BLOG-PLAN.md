# FactoryLM blog delivery and topic plan

Version 0.2, 2026-10-25 (America/New_York). Draft planning only. [STYLE-GUIDE](STYLE-GUIDE.md) governs content and review. This plan does not implement a publishing system, approve posts, change analytics, or schedule an automation.

## 1. Recommended first batch

Correct the three reviewed posts before expanding output. Start with the PowerFlex 525 article because it fits the drives focus and offers a useful stored-diagnostics workflow. Then revise Micro820. Keep the S7-1200 memory-card/password claim on hold until its applicability/source conflict is resolved. The detailed findings and evidence are in [README](README.md).

A useful initial series teaches technicians to distinguish the fault indication, evidence, possible cause, authorized correction and verification. Reuse those habits across a few supported equipment families. A daily quota must never push an unresolved procedure into publication.

| Priority | Deliverable | Evidence of completion |
|---|---|---|
| 1 | Correct the PowerFlex reset distinction and history explanation | Applicable OEM pages, consistent prose/figures/FAQ, source record and reviewed final artifact. |
| 2 | Reframe Micro820 as diagnosis plus a conditional recovery option | Attempt language everywhere, restore/card prerequisites before changes, no routine replacement-program shortcut. |
| 3 | Resolve or remove the S7-1200 unconditional card-preservation claim | Explicit CPU/firmware/TIA scope and resolved OEM conflict; erasure consequences before controls. |
| 4 | Repair common export issues | Absolute PDF links, readable figures, useful page breaks, no public preview metadata. |
| 5 | Verify product/contact wording and publication authority | Current claim evidence or the modest contact-only invitation; actual approved revision. |
| 6 | Release the approved batch and measure it | Released URLs/content revision, page checks and a baseline for search/contact metrics. |

## 2. Reuse the current site

The PR snapshot contains `mira-web/src/data/blog-posts.ts`, `mira-web/src/lib/blog-renderer.ts`, `mira-web/src/lib/blog-db.ts` and `mira-web/public/blog.css`. Inspect their current interfaces before implementing a content-loader change. The original plan's runtime, sitemap counts and deployment observations are historical inputs, not reverified live facts in this refinement.

Prefer the existing renderer and publishing path. Do not add a new CMS, database workflow, analytics container or generalized publishing framework to ship the first corrected articles. A Markdown folder may be a reasonable later implementation if it integrates with the current content shape and review controls.

Any implementation belongs in its own scoped change. This PR edits only six guide documents.

## 3. Review and publication are separate states

Preserve the current release policy. Content Studio drafts; technical review verifies the applicable source and material conditions; Search Steward checks editorial/search/claim consistency and exports; Mike approves the exact reviewed content under his existing authority; Foreman carries out an authorized release.

Use the current queue vocabulary where available. A record saying `review-for-mike` is not approval. A record saying `approved` needs a traceable reviewer/owner decision and exact revision; the string alone is not authority. Keep technical-review result, owner approval and actual release evidence distinct even if they are stored in one document.

The weekly-batch option is retained in [STYLE-GUIDE-part4-proposed](STYLE-GUIDE-part4-proposed.md). It is a way to reduce review overhead, not an additional confirmation round. Apply any already-recorded approval that covers the actual action and revision.

Do not let dates or unreviewed file edits publish content. If automation is later authorized, verify visibility against the current time at request time, or use a documented rebuild/refresh mechanism. **Filtering only at server startup will not make a future post appear when its date arrives.** Use an explicit publish timestamp with the America/New_York offset for that date, and the same rule for the direct route, index, sitemap, RSS and related links. Verify cache behavior at the release boundary.

A post that is in the same PR but scheduled later is not yet a valid related link. Show it only when available or describe it as forthcoming without a dead link.

## 4. Minimum editorial record

These are content requirements, not an implemented schema. Reuse existing fields and add only what the current pipeline needs:

| Record | Required information |
|---|---|
| Identity | Stable slug, reader question, article type, proposed title/description. |
| Scope | Manufacturer/model and material hardware, firmware and software versions. |
| Sources | Official URL, publication/revision/date, section/table, printed page and PDF page; forum provenance separately. |
| Claim review | Claim location, evidence, qualifications/conflicts, review result and reviewer/date. |
| Consequences | What changes, what could be lost, prerequisites and limits of the procedure. |
| Visuals | Purpose, source/rights, caption, alt text, final legibility. No mandatory image count. |
| Product wording | Approved claim references or contact-only wording; no inferred capability from the article. |
| Publication | Actual author/publisher, applicable owner decision, reviewed revision, intended time and released URL once live. |
| Verification | Readable web/PDF, link results, metadata alignment and corrected blockers. |

Record actual publication and modification dates separately from a review date and queue filename. Do not invent an author, technical credential, test result or customer story to fill an empty field.

## 5. Evidence for an implementation change

When publishing code is changed, verify the specific behavior that could fail:

- Unapproved/future posts are absent from every public surface, including direct URLs and feeds.
- A due, approved post becomes visible without an accidental dependency on a server restart.
- Cache/index behavior does not expose drafts or hide a due post indefinitely.
- Related links appear only when their targets are available.
- Metadata, structured data, sources, article body and PDF describe the same revision.
- PDF exports use absolute HTTPS links and omit internal preview metadata.

A link checker can flag a redirect, failure or bot challenge; it cannot verify manual applicability. Use manual verification when appropriate and record a blocked check honestly. Do not make “every URL returned 200 to a bot” the technical fact-check standard.

This documentation refinement does not require a product test suite or prove the proposed loader exists.

## 6. Thirty topic candidates retained from Grokbot

This is a research backlog, not a calendar or thirty approved articles. The collection notes below are preserved from the original October 25 draft and were **not re-run in this review**. `T-013` and “on box” refer to Grokbot's external workspace, not a file verified in this PR. Verify the actual source and applicable manual before drafting; an indexed result is not an opened source. The old “drafted” marker records prior drafting only, not approval.

| Candidate | Product | Question | Source URL | Original collection note | Original manual note |
|---|---|---|---|---|---|
| 1 | Micro820 | Flashing red fault after failed download, clear without CCW (**drafted**) | https://www.plctalk.net/forums/threads/micro820-fault-help.106371/ | 200 | 2080-UM005 |
| 2 | S7-1200 | How to factory reset (**drafted**) | https://www.plctalk.net/forums/threads/siemens-s7-1200-factory-reset.122271/ | 301→200 | S7-1200 SM |
| 3 | TP700 | Comfort losing all touch (**drafted**) | https://www.plctalk.net/forums/threads/siemens-tp700-comfort-losing-all-touch.117233/ | 200 | Comfort OI |
| 4 | PowerFlex 525 | F004 followed by F005 | https://www.plctalk.net/forums/threads/powerflex-525-f004-followed-by-f005.140604/ | 200 | Drive pack (520-UM001) |
| 5 | S7-1200 | Unlock CPU protection / lost password | https://www.plctalk.net/forums/threads/unlock-s7-1200-cpu-protection.146988/ | 200 | S7-1200 SM §6.5 |
| 6 | Micro820 | Failed downloads "brick" the unit | https://www.plctalk.net/forums/threads/micro820-failed-downloads-lead-to-a-bricked-unit.134972/page-2 | T-013 200 | UM005 App. C |
| 7 | Conveyor/VFD | Conveyor motors humming, overload on start | https://www.plctalk.net/forums/threads/motor-seizing-on-startup.139619/ | 200 | general (non-PF drive; no named brand in post) |
| 8 | PowerFlex 525 | Beginner: drive overload on run (motor data) | https://www.plctalk.net/forums/threads/powerflex-525-beginner-help.149269/ | 200 | Drive pack |
| 9 | S7-1200 | HMI shows #### instead of values (1212C) | https://www.plctalk.net/forums/threads/siemens-s7-1212c-tia-portal-on-hmi-appears-instead-of-real-values.150120/ | 200 | S7-1200 SM / Basic Panels OI |
| 10 | Micro820 | New unit: what's its IP? Not found | https://www.reddit.com/r/PLC/comments/1nr4ba0/micro820_configuration_issues/ | T-013 indexed | UM005 [IPA] p.120 |
| 11 | S7-1200 | Flashing LEDs, can't reset or connect | https://www.plctalk.net/forums/threads/s7-1200-flashing-leds-cant-reset-it-cant-connect.110799/ | T-013 200 | S7-1200 SM |
| 12 | PowerFlex 4 | F012 HW overcurrent at power-up | https://www.plctalk.net/forums/threads/powerflex4-fault.52470/ | 200 | needs PF4 manual |
| 13 | TP700 | Factory reset without TIA after failed OS update | https://sieportal.siemens.com/en-ww/support/forum/posts/factory-reset-tp700-comfort-without-tia-portal/130297 | T-013 indexed | Comfort OI §5.7 + FAQ 19701610 |
| 14 | Micro850 | USB connection not working | https://mrplc.com/forums/topic/45935-micro850-usb-connection/ | 200 | 2080-UM001 (on box) |
| 15 | S7-1200 | MTP700 Unified Basic can't write to PLC | https://www.plctalk.net/forums/threads/mtp700-unifi-basic-hmi-cannot-write-commands-to-siemens-s7-1200-plc.150135/ | 200 | missing (Unified Basic) |
| 16 | Micro820 | Can't connect over Ethernet, flashing fault | https://www.reddit.com/r/PLC/comments/13su0o2/micro_820_cant_connect/ | T-013 indexed | UM005 |
| 17 | Conveyor | Cabinet of PowerFlex 4s won't power up | https://www.plctalk.net/forums/threads/power-flex-4-powerup-problems.60771/ | 301→200 | needs PF4 manual |
| 18 | S7-1200 | CPU went to STOP, won't take program | https://www.reddit.com/r/PLC/comments/1h8ank0/stop_on/ | T-013 indexed | S7-1200 SM (diag buffer) |
| 19 | TP700 | Stuck at SIMATIC HMI boot screen | https://sieportal.siemens.com/en-ww/support/forum/posts/tp700-comfort-the-os-does-not-boot/168455 | T-013 indexed | Comfort OI + FAQ |
| 20 | Micro820 | Wiring sensors to inputs | https://www.plctalk.net/forums/threads/allen-bradley-micro820-plc-sensors.134162/ | T-013 200 | UM005 |
| 21 | GS20 drive | Runs over EtherNet/IP? FWD lit but won't run | https://www.plctalk.net/forums/threads/command-over-ethernet-ip-sysmac-studio-and-automation-direct-gs20.139484/ | 200 | GS20 manual App. B (public PDF, fetch) |
| 22 | Micro800 + PF | Micro830 to PowerFlex comms | https://www.plctalk.net/forums/threads/micro830-to-powerflex-communications-i-though-this-was-supposed-to-be-easy.75028/ | 200 | UM001 + drive pack |
| 23 | TP700 | ProSave reset stuck "Please boot the HMI device" | https://sieportal.siemens.com/en-ww/support/forum/posts/-/251724 | T-013 indexed | FAQ 19701610 |
| 24 | GS-series VFD | VFD on high-leg delta supply | https://www.plctalk.net/forums/threads/vfd-and-high-leg.150105/ | 200 | needs GS4 manual; safety-heavy, catalog-only |
| 25 | Micro820 | Analog input for a discrete device | https://electronics.stackexchange.com/questions/298909/can-i-use-an-analog-input-for-a-discrete-signal-field-device-on-the-a-b-micro820 | T-013 indexed | UM005 |
| 26 | Conveyor | Sudden "motor fault" but overload not tripped | https://www.plctalk.net/forums/threads/question-about-sudden-motor-faults.72781/ | 301→200 | general + 3RV2 MSP manual (on box) |
| 27 | PowerFlex 755 | Reserved "web enable" parameter | https://mrplc.com/forums/topic/45860-powerflex-755-reserved-web-enable-parameter/ | 200 | missing |
| 28 | Comfort panel | TP1200 "HmiRTm.exe serious error" | https://mrplc.com/forums/topic/45898-hmi-tp1200-comfort-panel-error-application-hmirtmexe-encountered-a-serious-error-and-must-shutdown/ | 200 | Comfort OI |
| 29 | S7-1200 G2 | Bogus analog values | https://www.reddit.com/r/PLC/comments/1pn65nj/im_getting_bogus_values_from_reading_analog_card/ | T-013 indexed | G2 manual missing |
| 30 | GS20 | Control GS20 frequency over EtherNet/IP (beginner) | https://community.automationdirect.com/s/question/0D5PE00000HQXgf0AH/help-a-beginner-control-gs20-frequency-via-ethernet-ip | search index only | GS20 App. B |

Candidates 12, 15, 17, 24, 27 and 29 were already flagged as missing manuals in the collection. Acquire and verify the relevant OEM source or defer the topic. Candidates about factory resets, lost passwords, firmware recovery, line voltage or grounding need the consequential-change scope in STYLE-GUIDE section 4. Do not reuse an S7-1200 manual for S7-1200 G2 without establishing applicability.

The TP700 draft was not attached for this review. The original plan flagged its external-mouse and `CalibrateTouchScreen` claims as unverified; keep those open rather than treating this three-post review as their clearance.

## 7. Cadence, reuse and measurement

Recommend one reviewed batch first, then adjust cadence to the ability to maintain accurate sources and respond to corrections. Daily publishing can be an eventual operating choice; it is not an SEO prerequisite or a commitment made by this guide.

Reuse a verified source record across related articles when its edition and applicability still match. Do not duplicate a page for superficial query variants. Prefer a better existing article over a new thin page. Review existing fault-code material for actual unsupported claims before proposing consolidation or indexing changes.

Use current analytics before choosing another tracker. Request Search Console/Bing access only when the next authorized task needs it. No new analytics integration or privacy conclusion is authorized here. Measure the chain from search impression to visit to contact action to an actual qualified inquiry; do not count a CTA click as a customer. Capture device/surface definitions, time window and known attribution limits.

GTM progress should be reported as corrected/released articles, useful technician feedback, qualified conversations and observed conversions. Do not invent ranking, traffic, latency or pilot-customer claims. The shortest next action is a corrected PowerFlex article, reviewed on its exact exported revision.
