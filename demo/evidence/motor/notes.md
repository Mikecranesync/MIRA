# Motor — conveyor gearmotor (GS10-driven)

**Asset:** the 3-phase induction motor the GS10 VFD drives to move the conveyor belt.
**Identity (as recorded in repo):** an **AC induction motor**, treated as **4-pole, 60 Hz → 1800 rpm
sync** (`RPM_PER_HZ = 30.0` in `plc/conv_simple_anomaly/` — "4-pole 60 Hz motor: 1800 rpm sync / 60 Hz").
Monitored via the GS10's `vfd_motor_rpm` / `vfd_torque` / `vfd_power` registers.

**MODEL: `UNKNOWN_MODEL`** — exact manufacturer/catalog number not recorded in the bench files.

## Honest status — exact model not recorded

The bench files record the motor's **electrical character** (3-phase, 4-pole, ~1800 rpm sync, small
fractional/integral-HP, GS10-driven) but **no manufacturer or catalog number**. No specific motor
datasheet is cited, and I will not invent one.

The authoritative document for *how this motor is run* is the **GS10 VFD manual** (see `../vfd/`): the
V/Hz curve, motor nameplate parameters (P01.xx), and overload protection are configured there, not on
the motor itself.

## To make this exact

Read the motor nameplate on the bench (HP, voltage, FLA, poles, RPM, frame, manufacturer) and record it
here; then add the motor datasheet `.url` if the maker publishes one. Until then this folder documents
the motor's **role + electrical character**, not a specific product.
