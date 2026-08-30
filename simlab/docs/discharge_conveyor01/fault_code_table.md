# Discharge Conveyor 01 Fault Code Table

| Code | Name | Severity | Condition | Likely Cause | Required Response |
|------|------|----------|-----------|--------------|-------------------|
| DC001 | Discharge Photoeye Blocked | FAULT | `photoeye_blocked = TRUE` during a discharge request | Package/pallet not removed, blocked beam, or downstream palletizer not accepting product | Clear package path, verify photoeye, confirm Micro820 safety chain |
| DC002 | Clear Timer Not Satisfied | WARN | `ready_for_next_discharge = FALSE` after photoeye transition | Photoeye has not been clear for more than 30 seconds | Keep discharge inhibited until the photoeye has stayed clear for more than 30 seconds |
