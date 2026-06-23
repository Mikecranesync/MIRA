# Conveyor — Conv_Simple belt

**Asset:** the conveyor itself — the belt the motor drives and the photoeye watches. The bench's name
for the whole cell is **Conv_Simple** (the PLC program lineage `plc/*Conv_Simple_v2.1*`).

## What it is

- **Visual / simulation layer:** **Factory I/O** (the optional visual twin; `plc/` references "Factory
  I/O" throughout, and `docs/simlab/factory-io-optional-adapter.md` documents it as the visual layer —
  the headless model is the source of truth).
- **Physical layer:** a small bench conveyor driven by the GS10 motor, with the PE-101 photoeye on `DI_05`.

## Documents

- **`factory-io-docs.url`** → Factory I/O documentation `https://docs.factoryio.com/` — the conveyor,
  diffuse/retro-reflective sensors, and the Modbus/AB driver used to couple Factory I/O to the Micro820.

## Honest status

A bench conveyor frame typically has no "manual" beyond the motor + drive + sensor it carries (each
documented in `../motor/`, `../vfd/`, `../photoeye/`). The Conv_Simple behaviour (run/stop, jam,
accumulation) is defined by the **ladder program** in `plc/` and the **anomaly rules** in
`plc/conv_simple_anomaly/` — those repo files are the authoritative "how this conveyor behaves" doc.
