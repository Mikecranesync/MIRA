# MIRA Architecture: ChatGPT-first Maintenance Genie

**Status:** Product architecture lock (Mike Harper, 2026-09-10)  
**Tracks:** #3735 · #3736 · #3742 · dogfood on Pixel `#3741` tip  
**One-line claim:** MaintainX makes you open the asset to talk; Fiix only talks from your CMMS; **MIRA talks like ChatGPT and ties to your machines when you mention them.**

---

## 1. The product we are building

MIRA is the **general maintenance genie** for a plant:

1. **Talk to it like ChatGPT** — educational, definitional, troubleshooting heuristics, "stupid questions" ("what is a VFD?") get real answers from the model.
2. **Project the factory from notes** — paste nameplates, shift notes, photos, OEM PDFs, tribal knowledge; MIRA turns that into a living plant model (assets, manuals, evidence).
3. **Opportunistically bind machines mid-conversation** — when the tech's words semantically match a machine in the tenant graph, offer a soft "Tie to …?" and only then pull manuals / history / citations.
4. **Never make unbound Ask fail-closed RAG** — "not in your sources" is for *bound* plant-scoped asks, not the home brain.

This inverts today's accidental product: ChatGPT *chrome* over a **notebook RAG runtime**.

---

## 2. How MIRA behaves differently (and better) for technicians

### 2.1 Day-in-the-life contrast

| Moment | Typical CMMS AI (MaintainX / Fiix / ST Atlas) | MIRA Maintenance Genie |
|---|---|---|
| Cold open | Open asset or job first, or chat that only knows tenant docs | Composer home; ask anything immediately |
| "What is a VFD?" | Empty / refuse / only if in uploaded manuals | Clear general answer + `General` badge |
| "GS10 on line 3 is faulting" | Must already be on that asset, or fail-closed miss | Answers generally **and** offers pill: *Tie to AutomationDirect GS10?* |
| After tech taps Tie | Manuals + WO history + citations | Same — **moat starts here** |
| Paste shift notes / photo of nameplate | Often a separate "upload to asset" workflow | In-chat ingest → propose asset create/bind → project factory graph |
| Wrong answer risk | Silent hallucination or mute refuse | Explicit badges: `General` / `Plant record` / `Manual p.N` |
| Create WO | Chip / draft | Chip + preview + approve (never silent write) |

### 2.2 Why this is better on the floor

- **Time-to-first-useful-answer** without knowing which asset screen to open (ChatGPT-fast).
- **Senior tech in the pocket** for theory and heuristics, not only "search my PDFs."
- **Plant truth on demand**, not as a gate — when the machine is known, citations beat vibes.
- **Factory projection** — notes and manuals become structure, so the genie gets smarter about *your* plant over time without forcing the tech to be a CMMS librarian first.

### 2.3 Honest moat (keep)

After bind: page-level citations to the customer's manual, refuse inventions about that machine's docs, persisted evidence basis, offline WO queue, camera/nameplate spine. Moat is **enrichment after bind**, not the front door.

---

## 3. Layered runtime (normative)

```
L0  Unbound generative Ask     ← default home (ChatGPT wrapper)
L1  Entity linker (tools)      ← every user turn, background, never user-visible fail
L2  Offer UX                   ← entity pill + "Tie?" / top-3 picker; NEVER silent bind
L3  Bound hybrid Ask           ← general + plant tools (manuals, history, meters)
L4  Writes                     ← WO/procedure drafts → preview → Approve
L5  Honesty badges             ← General | Plant record | Manual p.N
```

**Evidence rules**

- Unbound → may answer from model prior; must label `general_reasoning`.
- Bound + retrieval hit → cite manual/page; plant facts win over general when they conflict.
- Bound + retrieval miss → still may answer generally **and** say plant docs didn't match — do **not** only emit sources-miss copy unless the user demanded grounded-only.

---

## 4. Open-source references (true patterns to steal)

### 4.1 ChatGPT-like shell + tools (L0 + L1)

| Project | What it proves | Steal for MIRA |
|---|---|---|
| [open-webui/open-webui](https://github.com/open-webui/open-webui) + [Tools docs](https://docs.openwebui.com/features/extensibility/plugin/tools/) | Chat-first UI; model-callable **Tools**; event emitters; MCP | Composer-home; plant tools, not RAG-as-only-brain |
| [danny-avila/LibreChat](https://github.com/danny-avila/LibreChat) | Multi-provider ChatGPT UX; agents/tools | Multi-turn general chat UX |
| [continuedev/continue](https://github.com/continuedev/continue) | General chat + **context providers** + tools | Context is additive, not the prior |
| [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) | External general LLM + tools into SoR | Plant graph as tool surface |

### 4.2 Orchestration / hybrid RAG (L1–L3)

| Project | What it proves | Steal for MIRA |
|---|---|---|
| [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph) | Graph + human-in-the-loop interrupt | L0→L2→L3 with interrupt on Tie? |
| [run-llama/llama_index](https://github.com/run-llama/llama_index) | Router query engines; hybrid retrieval | Router: general vs bound plant index |
| [langchain-ai/langchain](https://github.com/langchain-ai/langchain) | Tool-calling agents | Default agent + optional retrieval tools |
| [microsoft/semantic-kernel](https://github.com/microsoft/semantic-kernel) | Plugins + planners | Plugins: Assets, Manuals, WorkOrders |
| [Mintplex-Labs/anything-llm](https://github.com/Mintplex-Labs/anything-llm) | Workspaces = optional corpora | Notebook/Project ≠ mandatory RAG identity |

### 4.3 Human confirm gates (L2, L4)

| Project | Steal |
|---|---|
| LangGraph interrupt / HITL | Tie? and Create WO require explicit human resume |
| Open WebUI `__event_call__` | Soft bind mid-turn |

### 4.4 Citation / honesty (L5)

| Project | Steal |
|---|---|
| LlamaIndex source nodes | Manual p.N badges |
| Open WebUI RAG citations | Don't fake citations on general answers |
| MaintainX "View in manual" (commercial UX) | Match **after bind** |

### 4.5 Anti-patterns

| Source | Anti-pattern |
|---|---|
| Fiix MAX | Fail-closed tenant-only epistemology |
| MaintainX Assist entry | Must open asset to chat |
| MIRA today | `mode: general` only if `scope.length===0` → junk sources force refuse |

---

## 5. MIRA code seams (reuse)

| Need | Prefer | Avoid |
|---|---|---|
| General Ask | `mode: "general"` and/or `/api/hub/ask` (#3682) | Third brain / pipeline bots |
| Shell | #3731 + #3737 V4 | New V5 route |
| Bound manuals | notebook chat → manual-rag → citation SSE | Collapsing sellable path into hub/ask forever |
| Evidence | `general_reasoning` parts | Fake citations |

---

## 6. Factory projection from notes

```
notes / photos / PDFs / voice
        → ingest + extract
        → propose Asset nodes (confirm)
        → attach manuals
        → bound Ask with citations
        → living plant graph
```

---

## 7. Delivery sequence

| Priority | Slice | Done |
|---|---|---|
| P0 | #3742 unbound Ask | "what is a VFD?" works on Pixel |
| P1 | Entity linker + Tie? | Mention machine → offer bind |
| P1 | Dual badges | General vs Manual p.N |
| P2 | Notes→factory | Paste/photo → propose assets |
| P2 | Write chips | WO preview/approve |

---

## 8. GTM line

> **MIRA is ChatGPT that knows your plant when you need it to.** Other CMMS AIs make you pick the asset first or refuse outside your uploads. That's a librarian. MIRA is a genie.
