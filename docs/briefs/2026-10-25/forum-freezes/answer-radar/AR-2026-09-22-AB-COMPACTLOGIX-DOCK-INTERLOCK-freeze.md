# AR freeze — Allen-Bradley CompactLogix dock door / conveyor interlock

- freeze_id: AR-2026-09-22-AB-COMPACTLOGIX-DOCK-INTERLOCK
- url: https://mrplc.com/forums/topic/45922-interlock-logic-for-dock-door-and-conveyor-safety-on-compactlogix/
- forum: MrPLC / Allen Bradley / Rockwell Automation
- topic_id: 45922
- posted_at: 2026-09-22T07:47:08Z
- author: toma
- age_at_freeze_hours: 6.46
- community_replies_read: false (OP frozen before using replies)
- answer_researched: false
- FactoryLM/MIRA/coding workers: not called

## Original post (verbatim)
Setting up interlock logic on a CompactLogix system for a loading dock area, and want to make sure the conveyor won't run unless the dock door is fully open and the safety light curtain is clear.

Also need to handle the case where a truck backs out mid-cycle without leaving the system stuck in a bad state.

Right now I'm just chaining a few AND conditions together, but I'm wondering if there's a more standard way people structure this kind of interlock sequence in RSLogix/Studio 5000, maybe using a state machine or sequencer instruction instead of a flat rung.

Also been getting some false triggers off the dock door position sensor and I'm not sure if that's a debounce issue in the ladder logic or something on the sensor side. Curious how others have set this up in similar dock automation projects.

## Technician Version (format only)
I am setting up interlock logic on an Allen-Bradley CompactLogix for a loading dock so the conveyor will not run unless the dock door is fully open and the safety light curtain is clear. I also need to handle a truck backing out mid-cycle without leaving the system stuck. I am currently chaining AND conditions in RSLogix/Studio 5000 and wondering whether a state machine or sequencer is the more standard pattern. The dock door position sensor is also giving false triggers — is that usually a ladder debounce issue or a sensor-side problem?

## Why freeze
Real technician interlock/safety programming question with a specific OEM/platform (Allen-Bradley CompactLogix), concrete application (dock door open + safety light curtain clear before conveyor run; truck backs out mid-cycle), software context (RSLogix/Studio 5000 state machine vs flat AND rungs), and a related debounce/false-trigger symptom on the dock door position sensor. Fresh at ~6.46 hours (well inside preferred 24–48h). Suitable for Rockwell CompactLogix / Studio 5000 / safety interlock and input debounce manuals. Frozen from the OP only; replies were not used and no answer research was performed.

- archaeologist: CONSOLIDATE / Gate BLOCKED
- approved_for_factorylm_ops_test: NO
- canonical: mira-mobile askNotebook/SSE → Hub POST /api/equipment-notebooks/{id}/chat/ → retrieveNodeChunks → citation SSE → optional nameplate PDF discoverManual
- connect_manuals: Rockwell CompactLogix / Logix 5000 Controllers Programming Manual; Studio 5000 / RSLogix 5000 sequencer & state-machine patterns; Rockwell safety interlocking / light-curtain application notes; discrete input debounce / filter guidance for Logix
- brief: /workspace/briefs/2026-09-22-AR-AB-COMPACTLOGIX-DOCK-INTERLOCK-archaeology.md
