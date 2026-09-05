# eval-fixer run — 2026-09-04 (charlienodes-mac-mini)

- Scorecard: 57/65 passing (87%) — `2026-09-04T0227-offline-text.md`, runtime 1434s, best card on record
- Action: issue-filed (comment on #1876); no patch (8 failures span 3 file clusters)
- Decomposition: **0 timeout placeholders + 8 genuine** — second consecutive zero-timeout night. Graded tree `b09bb8d26` (main + #3553 timing commit + fragments); no engine change on main since 09-02.
- Stable-5 backlog unchanged, now 5/5 clean cards: `control_refusal_clean_26` (KB-gap footer, `engine.py` ≈1149/1193, deterministic — first target), `pf525_f004_02`, `topic_switch_gs10_to_pf525_22`, `self_critique_low_groundedness_34`, `gs3_ground_fault_14`. `gs20_cross_vendor_03` 4/5.
- Flickers: last night's router-STOP trio (18/27/22) passed; new tonight `vfd_ab_02_pf755` (Q1, #3086 shape, 1/5) and `vfd_mitsu_01_fr_d720` (Q1, offered "PowerFlex 40P" for a Mitsubishi — #3049 shape; 30.0s turn with no placeholder — #3085 data point; 2/5).
- Delivery: PR #3553 is DRAFT + BEHIND main; fragment pushed onto it — needs a human rebase + un-draft.
