# Offline defect lab

Deterministic sweep of every frozen campaign ledger. No live bot, no LLM.

- conversations: **345**
- replies scanned: **671**
- actionable findings: **54**

| detector | count | note |
|---|---|---|
| `reasks_supplied_info` | 44 | negative control — UNS confirmation gate legitimately confirming an asset switch |
| `contained_repeat` | 29 |  |
| `repeated_answer` | 15 |  |
| `near_duplicate` | 9 |  |
| `fabricated_specific` | 1 |  |

## Actionable

| campaign | conversation | turn | detail |
|---|---|---|---|
| c1 | `t3_41_000` | 5 | turn 4 reproduced in turn 5 (ratio 1.000, frac 1.000) |
| c1 | `t3_41_000` | 6 | turn 1 reproduced in turn 6 (ratio 0.946, frac 0.897) |
| c1 | `t3_41_000` | 9 | turn 1 reproduced in turn 9 (ratio 1.000, frac 1.000) |
| c1 | `t3_41_000` | None | [repeated_answer] t3_41_000: identical reply emitted 2x: "i want to find that manual for you. what's the **brand or manufacturer**? (you can also say 'back to" |
| c1 | `t3_41_000` | None | [repeated_answer] t3_41_000: identical reply emitted 2x: "before i diagnose, i need to know the equipment. tell me the manufacturer and model (e.g., 'allen-br" |
| c1 | `t3_41_001` | 5 | turn 1 reproduced in turn 5 (ratio 0.946, frac 0.897) |
| c1 | `t3_41_001` | 6 | turn 1 reproduced in turn 6 (ratio 1.000, frac 1.000) |
| c1 | `t3_41_001` | 8 | turn 1 reproduced in turn 8 (ratio 1.000, frac 1.000) |
| c1 | `t3_41_001` | None | [repeated_answer] t3_41_001: identical reply emitted 2x: "before i diagnose, i need to know the equipment. tell me the manufacturer and model (e.g., 'allen-br" |
| c1 | `t3_41_002` | 2 | turn 1 reproduced in turn 2 (ratio 1.000, frac 1.000) |
| c1 | `t3_41_002` | 6 | turn 1 reproduced in turn 6 (ratio 0.946, frac 0.897) |
| c1 | `t3_41_002` | 8 | turn 1 reproduced in turn 8 (ratio 0.946, frac 0.897) |
| c1 | `t3_41_002` | 9 | turn 1 reproduced in turn 9 (ratio 1.000, frac 1.000) |
| c1 | `t3_41_002` | None | [repeated_answer] t3_41_002: identical reply emitted 2x: "before i diagnose, i need to know the equipment. tell me the manufacturer and model (e.g., 'allen-br" |
| c1 | `t3_41_002` | None | [repeated_answer] t3_41_002: identical reply emitted 2x: 'diagnosing... before i diagnose, i need to know the equipment. tell me the manufacturer and model (e' |
| c1 | `t3_41_003` | 5 | turn 4 reproduced in turn 5 (ratio 0.912, frac 0.932) |
| c1 | `t3_41_003` | 7 | turn 3 reproduced in turn 7 (ratio 1.000, frac 1.000) |
| c1 | `t3_41_003` | None | [repeated_answer] t3_41_003: identical reply emitted 2x: 'diagnosing... before i can give you a confident diagnosis, could you share one more detail — what ex' |
| c1 | `t3_41_004` | 6 | turn 3 reproduced in turn 6 (ratio 0.939, frac 1.065) |
| c1 | `t8_41_000_novice` | 4 | turn 3 reproduced in turn 4 (ratio 1.000, frac 1.000) |
| c1 | `t8_41_000_novice` | None | [repeated_answer] t8_41_000_novice: identical reply emitted 2x: "i want to find that manual for you. what's the **brand or manufacturer**? (you can also say 'ba |
| c1 | `t8_41_001_experienced` | 4 | turn 1 reproduced in turn 4 (ratio 0.946, frac 0.897) |
| c1 | `t8_41_001_experienced` | 6 | turn 1 reproduced in turn 6 (ratio 0.946, frac 0.897) |
| c1 | `t8_41_001_experienced` | None | [repeated_answer] t8_41_001_experienced: identical reply emitted 2x: 'diagnosing... before i diagnose, i need to know the equipment. tell me the manufacturer an |
| c1 | `t8_41_003_impatient` | 6 | turn 3 reproduced in turn 6 (ratio 1.000, frac 1.000) |
| c1 | `t8_41_003_impatient` | 7 | turn 3 reproduced in turn 7 (ratio 0.973, frac 0.948) |
| c1 | `t8_41_003_impatient` | 8 | turn 3 reproduced in turn 8 (ratio 0.981, frac 0.962) |
| c1 | `t8_41_003_impatient` | 9 | turn 7 reproduced in turn 9 (ratio 0.913, frac 0.989) |
| c1 | `t8_41_003_impatient` | None | [repeated_answer] t8_41_003_impatient: identical reply emitted 2x: "check the display for a fault code i don't have specific documentation indexed for this — co |
| c1 | `t8_41_004_overconfident` | 3 | turn 2 reproduced in turn 3 (ratio 0.907, frac 1.053) |
| c1 | `t8_41_005_context_switcher` | 3 | turn 1 reproduced in turn 3 (ratio 0.994, frac 1.012) |
| c1r2 | `t2_005_pivot_after_fault` | 2 | turn 1 reproduced in turn 2 (ratio 0.692, frac 0.529) |
| c1r4 | `t2_s42_000_pivot_after_fault` | 2 | turn 1 reproduced in turn 2 (ratio 0.871, frac 0.772) |
| c2 | `t8_41_000_novice` | 3 | turn 2 reproduced in turn 3 (ratio 0.911, frac 1.051) |
| c2 | `t8_41_000_novice` | 5 | turn 4 reproduced in turn 5 (ratio 1.000, frac 1.000) |
| c2 | `t8_41_000_novice` | None | [repeated_answer] t8_41_000_novice: identical reply emitted 2x: "i want to find that manual for you. what's the **brand or manufacturer**? (you can also say 'ba |
| c2 | `t8_41_001_experienced` | 5 | turn 1 reproduced in turn 5 (ratio 1.000, frac 1.000) |
| c2 | `t8_41_001_experienced` | 6 | turn 1 reproduced in turn 6 (ratio 0.946, frac 0.897) |
| c2 | `t8_41_001_experienced` | 7 | turn 1 reproduced in turn 7 (ratio 1.000, frac 1.000) |
| c2 | `t8_41_001_experienced` | 8 | turn 1 reproduced in turn 8 (ratio 0.946, frac 0.897) |
| c2 | `t8_41_001_experienced` | None | [repeated_answer] t8_41_001_experienced: identical reply emitted 2x: "before i diagnose, i need to know the equipment. tell me the manufacturer and model (e.g., |
| c2 | `t8_41_001_experienced` | None | [repeated_answer] t8_41_001_experienced: identical reply emitted 2x: 'diagnosing... before i diagnose, i need to know the equipment. tell me the manufacturer an |
| c2 | `t8_41_002_confused` | 9 | turn 3 reproduced in turn 9 (ratio 0.955, frac 0.914) |
| c3 | `t8_41_000_novice` | 2 | turn 1 reproduced in turn 2 (ratio 0.946, frac 1.115) |
| c3 | `t8_41_001_experienced` | 3 | turn 2 reproduced in turn 3 (ratio 1.000, frac 1.000) |
| c3 | `t8_41_001_experienced` | 7 | turn 1 reproduced in turn 7 (ratio 1.000, frac 1.000) |
| c3 | `t8_41_001_experienced` | 9 | turn 1 reproduced in turn 9 (ratio 0.946, frac 0.897) |
| c3 | `t8_41_001_experienced` | None | [repeated_answer] t8_41_001_experienced: identical reply emitted 2x: "i want to find that manual for you. what's the **brand or manufacturer**? (you can also sa |
| c3 | `t8_41_001_experienced` | None | [repeated_answer] t8_41_001_experienced: identical reply emitted 2x: "before i diagnose, i need to know the equipment. tell me the manufacturer and model (e.g., |
| c3 | `t8_41_003_impatient` | 6 | turn 4 reproduced in turn 6 (ratio 1.000, frac 1.000) |
| c3 | `t8_41_003_impatient` | 9 | turn 8 reproduced in turn 9 (ratio 0.958, frac 1.016) |
| c3 | `t8_41_003_impatient` | None | [repeated_answer] t8_41_003_impatient: identical reply emitted 2x: 'before i can give you a confident diagnosis, could you share one more detail — what exact fa |
| c6 | `t2_000_pivot_after_fault` | 2 | turn 1 reproduced in turn 2 (ratio 0.765, frac 0.619) |
| c7 | `t2_005_pivot_after_fault` | 2 | 'P0594' asserted but absent from the corpus |
