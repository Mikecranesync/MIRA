# Discharge Conveyor 01 Operator Quick Guide

Discharge Conveyor 01 represents the garage Micro820/GS10 conveyor used as the case-packer discharge conveyor in the bottling-line demo.

Normal discharge sequence:

1. CasePacker01 raises a discharge request when a package is ready.
2. The Micro820 remains the motion-control authority for the conveyor.
3. The conveyor runs until the discharge photoeye is blocked by the package.
4. After the package or pallet is removed, the photoeye must be clear for more than 30 seconds.
5. Only then is `ready_for_next_discharge` true for the next transfer.

Default SimLab mode is headless simulation only. Live hardware control is not enabled by this document.
