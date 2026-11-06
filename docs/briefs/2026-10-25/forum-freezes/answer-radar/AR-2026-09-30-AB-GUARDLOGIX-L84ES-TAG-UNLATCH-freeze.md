# AR freeze — Rockwell 1756-L84ES GuardLogix latch fails to unlatch

- freeze_id: AR-2026-09-30-AB-GUARDLOGIX-L84ES-TAG-UNLATCH
- url: https://www.plctalk.net/forums/threads/cant-figure-out-why-this-tag-didnt-unlatch-rockwell-1756-l84es-guardlogix-5580-safety-controller.150070/
- forum: PLCTalk / PLC Questions and Answers
- topic_id: 150070
- posted_at: 2026-09-30T05:23:10Z
- posted_local_ET: 2026-09-30T01:23:10-0400
- author: red_dog
- age_at_freeze_hours: 8.23
- community_replies_read: false (OP frozen before using replies for answer)
- answer_researched: false
- FactoryLM/MIRA/coding workers: not called

## Original post (verbatim)
Hi everyone. Idiot-grad here so sorry if the answer to this question is really obvious (it has stumped my boss and another coworker so surely it can't be that obvious). I can't figure out for the life of me why S.COIL[6] doesn't unlatch after S.REAL[3] falls back below S.REAL[2] (See attached pictures.) The third and fourth pictures show a zoomed in view of (1) latching event in the second picture. I've obfuscated all the tag-names and descriptions in the PLC screenshot but the type-indications, indices and anything else I figured might be relevant are the same.

All the signals shown have been sampled at a period of 250ms with the exception of P.DT.ZT001 which has been sampled at 50ms.

Controller is Rockwell 1756-L84ES Guardlogix 5580 Safety Controller. Revision 33.015. Using Studio5000.

S.COIL[6] has no other destructive references other than what you can see in the picture. S.COIL[8] has no other references. They are program-scope tags so I don't think they're being written to by another controller.

The program itself is a continuous task. This particular piece of logic, as far as I can make out, is rarely triggered during normal operation. The intention of the latch is to prevent a sequence from falsely triggering in the event that the delta of analog value P.DT.ZT001 exceeds the change-tolerance for that scan (S.REAL[2]). It is supposed to unlatch once that delta (S.REAL[3]) falls back below/within tolerance. In this case it caused a real incident where the failure to unlatch prevented the sequence from occurring where it should have occurred.

S.REAL[4] is the "last" value of P.DT.ZT001 while S.REAL[7] is the "last healthy" value of P.DT.ZT001.

I first figured there must be some kind of rapid same-scan latching and unlatching occurring but if this was the case you would see S.REAL[4] updating to the value of P.DT.ZT001 and it never does until S.COIL[6] gets unlatched by PA.ST.ZS002. It stays at the same value as when the latch occurred for the entire duration.

Unfortunately, I can't trend S.COIL[8]. I can't trend S.REAL[7] either but it looks right judging by the values of P.DT.ZT001 and S.REAL[3].

It's entirely possible that tags were manually toggled but the boss says we don't use forces (we use bridges instead if we need to do that). The only thing I can think of is if the ONS storage bit got toggled somehow, preventing it from firing - but for that to be possible the toggle would have had to occur at the moment the input condition became true since it would otherwise have just been set back to 0. This doesn't seem plausible.

Yeah, I'm at a loss. I tried toggling bits in the sim PLC and the logic seems to work fine. Maybe someone was waving a big magnet around the PLC?? Please let me know if I've left out any critical pieces of information (I'm new here and new to PLCs in general). Thanks in advance.

## Technician Version (format only)
I work with a Rockwell 1756-L84ES GuardLogix 5580 Safety Controller (revision 33.015) in Studio 5000. In a continuous task, latch bit S.COIL[6] is supposed to unlatch when the delta S.REAL[3] of analog P.DT.ZT001 falls back below change-tolerance S.REAL[2], but it stayed latched and blocked a sequence until PA.ST.ZS002 unlatched it. S.COIL[6] has no other destructive references; S.REAL[4] (last value) never updates while latched; the sim behaves correctly. Why wouldn't the unlatch fire after the delta returns within tolerance?

## Why freeze
Real technician fault/symptom question with specific OEM model (Rockwell 1756-L84ES GuardLogix 5580 Safety Controller, rev 33.015, Studio 5000), concrete latch/unlatch failure on analog delta tolerance logic (S.COIL[6] / S.REAL[2]/[3], continuous task), and a production incident. Fresh at ~8.23h (inside preferred 24–48h). Suitable for GuardLogix / Studio 5000 OTL-OTU-ONS manuals. MrPLC had no new qualifying OPs past already-frozen 45928 (only promo 45931, download 45930, prior runner-up Keyence FB 45929). Frozen from the OP only; replies were not used for the freeze decision and no answer research was performed.

- archaeologist: CONSOLIDATE / Gate BLOCKED
- approved_for_factorylm_ops_test: NO
- canonical: mira-mobile askNotebook/SSE → Hub POST /api/equipment-notebooks/{id}/chat/ → retrieveNodeChunks → citation SSE → optional nameplate PDF discoverManual
- connect_manuals: GuardLogix 5580 / 1756-L84ES user + safety manuals; Studio 5000 Logix Designer OTL/OTU/ONS instruction reference; continuous-task scan / destructive-reference rules; GuardLogix safety vs standard tag mapping notes (if latch involves safety tags)
- brief: /workspace/briefs/2026-09-30-AR-AB-GUARDLOGIX-L84ES-TAG-UNLATCH-archaeology.md
