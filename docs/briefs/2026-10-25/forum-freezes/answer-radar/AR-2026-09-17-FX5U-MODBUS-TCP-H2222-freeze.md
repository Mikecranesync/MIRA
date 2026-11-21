# AR freeze — Mitsubishi FX5U Modbus TCP H2222

- freeze_id: AR-2026-09-17-FX5U-MODBUS-TCP-H2222
- url: https://mrplc.com/forums/topic/45913-fx5u-modbus-tcp-communication/
- forum: MrPLC / Mitsubishi
- topic_id: 45913
- posted_at: 2026-09-17T06:53:10Z
- author: Tuan21
- age_at_freeze_hours: ~7
- community_replies_read: false (OP frozen before using replies)
- answer_researched: false
- FactoryLM/MIRA/coding workers: not called

## Original post (verbatim)
Hello everyone, i encouted a problem when i setting parameter of fx5u, when i add function modbus and check, do not error have been found, but when i write this parameter to pc, plc error and i can't change to run mode. alarm code when i check in gx3 is h2222. what is the problem and how can i fix this? thanks!

## Technician Version (format only)
I have a Mitsubishi FX5U PLC. I added the Modbus TCP function in GX Works3; parameter check passes with no errors. After I write the parameters to the PLC, it faults and I cannot switch to RUN. GX Works3 shows alarm code H2222. What causes H2222 on FX5U with Modbus TCP, and how do I clear it so the PLC can run?

## Why freeze
Specific OEM (Mitsubishi) + model (FX5U) + symptom (cannot RUN after Modbus param write) + fault code (H2222) + tool (GX Works3). Fresh (~7h). Suitable for FactoryLM mobile notebook Q&A with FX5U / GX Works3 / Modbus manuals.

- archaeologist: CONSOLIDATE / Gate BLOCKED
- canonical: mira-mobile askNotebook/SSE → Hub POST /api/equipment-notebooks/{id}/chat/ → retrieveNodeChunks → citation SSE → optional nameplate PDF discoverManual
- brief: /workspace/briefs/2026-09-17-AR-FX5U-MODBUS-TCP-H2222-archaeology.md
