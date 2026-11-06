# AR freeze — Mitsubishi Q06UDV built-in Ethernet Modbus TCP server

- freeze_id: AR-2026-09-29-MITSUBISHI-Q06UDV-MODBUS-TCP-BUILTIN
- url: https://mrplc.com/forums/topic/45928-mitsubishi-melsec-q-buildin-ethernet/
- forum: MrPLC / Mitsubishi
- topic_id: 45928
- posted_at: 2026-09-28T07:56:00Z
- author: Tuan21
- age_at_freeze_hours: 29.98
- community_replies_read: false (OP frozen before using replies)
- answer_researched: false
- FactoryLM/MIRA/coding workers: not called

## Original post (verbatim)
Hello everyone, im a newbie. i work with mitsubishi q06udv. i want to communication with plc from a pc software with modbus tcp, pc software is client and plc is server. before, i use module qj71mt91 but i newly discovery about predefine protocol with buildin ethernet. how can i config communication modbus tcp server with builin ethernet?? i watch some tutorial and all of them config communication as client. thank all for your support!

## Technician Version (format only)
I work with a Mitsubishi Q06UDV PLC. I need PC software to communicate with the PLC over Modbus TCP, with the PC as client and the PLC as server. I previously used a QJ71MT91 module and now want to use predefined protocol on the built-in Ethernet port. How do I configure Modbus TCP server mode on the Q06UDV built-in Ethernet? The tutorials I found only show client configuration.

## Why freeze
Real technician communication/howto question with specific OEM model (Mitsubishi Q06UDV), prior hardware path (QJ71MT91), and a concrete need (configure Modbus TCP server on built-in Ethernet / predefined protocol; PC client → PLC server). Fresh at ~29.98 hours (inside preferred 24–48h). Suitable for MELSEC-Q built-in Ethernet and Modbus TCP server/predefined-protocol manuals. Fresher Keyence FB topic (45929) kept as runner-up (less model-specific). Skipped for-sale/promo (45927/45930), already-frozen 45919/45922, and older CIP NJ topic (45925 >72h). Frozen from the OP only; replies were not used for the freeze decision and no answer research was performed.

- archaeologist: CONSOLIDATE / Gate BLOCKED
- approved_for_factorylm_ops_test: NO
- canonical: mira-mobile askNotebook/SSE → Hub POST /api/equipment-notebooks/{id}/chat/ → retrieveNodeChunks → citation SSE → optional nameplate PDF discoverManual
- connect_manuals: Mitsubishi Q06UDV / QnU built-in Ethernet port settings; Modbus TCP server (slave) via predefined protocol or FB library; GX Works2 predefined protocol / SP.ECPRTCL notes; QJ71MT91 vs built-in Ethernet Modbus comparison
- brief: /workspace/briefs/2026-09-29-AR-MITSUBISHI-Q06UDV-MODBUS-TCP-BUILTIN-archaeology.md
