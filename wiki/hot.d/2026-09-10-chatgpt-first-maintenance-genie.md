# ChatGPT-first Maintenance Genie Architecture Lock

**Date:** 2026-09-10  
**Status:** Merged to main  
**Issues:** #3742 #3743 #3735

Architecture document locked by Mike Harper (CEO).

See full architecture: [[architecture/chatgpt-first-maintenance-genie]]

**Key points:**
- MIRA talks like ChatGPT (general maintenance genie)
- Opportunistic machine binding (not fail-closed RAG)
- Factory projection from notes/photos/manuals
- L0–L5 layered runtime with honesty badges
- GTM: "ChatGPT that knows your plant when you need it to"

**Implementation:**
- P0: #3742 unbound Ask
- P1: Entity linker + Tie? + dual badges
- P2: Notes→factory projection + WO chips
