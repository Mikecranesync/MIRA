# AR freeze — Allen-Bradley Kinetix 6500 M04 feedback filter noise (shield clamp)

- freeze_id: AR-2026-10-01-AB-KINETIX-6500-M04-NOISE
- url: https://www.plctalk.net/forums/threads/disconnecting-shield-on-servo-power-cable-stops-noise-fault.150077/
- forum: PLCTalk / PLC Questions and Answers
- topic_id: 150077
- posted_at: 2026-09-30T18:51:29Z
- posted_local_ET: 2026-09-30T14:51:29-0400
- author: patrickmoneyy
- age_at_freeze_hours: 18.76
- community_replies_read: false (OP frozen before using replies for answer)
- answer_researched: false
- FactoryLM/MIRA/coding workers: not called

## Original post (verbatim)
I was fighting a kinetix 6500 axis that was giving me M04 feedback filter noise fault. Feedback cable had been "Temporarily" spliced around 6 months ago and had been problem free.

I moved the power and feedback to an identical axis drive next to it and the fault followed to the other drive, quickly eliminating the drive as a culprit (It never is but everyone blames the drive so I always knock it out quickly)

I then swapped the motor with a new one, eliminating that. 

We then pulled new feedback and power cables and I replaced the feedback connector at the drive.

Night shift fought it half of the night. On a whim the night shift tech pulled the motor power cable out of the shield clamp on top of the drive and the fault hasnt returned. Anyone know what kind of grounding shenanigans might cause this? I considered installing a clamp on the panel and landing the shield there instead of on the drive clamp. All of these drives are connected the same way though so I assume something has to be funky with hardware associated with this particular axis.

## Technician Version (format only)
I work with an Allen-Bradley Kinetix 6500 axis that keeps throwing an M04 feedback filter noise fault. The feedback cable had been temporarily spliced ~6 months ago and ran fine until now. Swapping the axis drive, motor, and pulling new feedback/power cables (plus replacing the drive feedback connector) did not clear it—the fault followed the cables/axis hardware, not the drive. Night shift pulled the motor power cable shield out of the shield clamp on top of the drive and the M04 stopped returning. Why would landing the power-cable shield on the drive clamp cause M04 feedback filter noise on this axis when neighboring identical drives are clamped the same way?

## Why freeze
Real technician fault/symptom question with specific OEM model (Allen-Bradley / Rockwell Kinetix 6500), concrete fault code M04 feedback filter noise, and a production-style swap/isolate sequence ending in a shield-clamp grounding symptom. Fresh at ~18.76h (inside preferred 24–48h). Suitable for Kinetix 6500 user / installation / grounding & shielding / feedback noise manuals in FactoryLM mobile notebook RAG. MrPLC had no new qualifying OPs past already-frozen 45928 (45931 promo, 45930 download, 45929 Keyence FB near-miss; 45932+ 404). PowerFlex 40 MSG (150057) skipped as ~96h over 72h hard cap. Frozen from the OP only; replies were not used for the freeze decision and no answer research was performed.

- archaeologist: CONSOLIDATE / Gate BLOCKED
- approved_for_factorylm_ops_test: NO
- canonical: mira-mobile askNotebook/SSE → Hub POST /api/equipment-notebooks/{id}/chat/ → retrieveNodeChunks → citation SSE → optional nameplate PDF discoverManual
- connect_manuals: Kinetix 6500 user + installation manuals; motor power / feedback cable grounding & shield clamp guidance; M04 Feedback Filter Noise fault description and corrective actions; EMC bonding / panel shield landing notes for multi-axis panels
- brief: /workspace/briefs/2026-10-01-AR-AB-KINETIX-6500-M04-NOISE-archaeology.md
