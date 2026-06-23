# Photoeye — PE-101 on `DI_05`

**Asset:** the conveyor photoelectric sensor that detects product / a jam on the belt.
**Identity (as recorded in repo):** tag **`di05_photoeye`**, labelled **PE-101**, wired to Micro820
**`DI_05`** (coil 000023 in the slave map). It drives anomaly **A12 — "Photo-eye jam (continuous
block)"** in `plc/conv_simple_anomaly/`.

**MODEL: `UNKNOWN_MODEL`** — exact manufacturer/catalog number not recorded in the bench files.

## Honest status — exact model not recorded

The bench files name the **tag, role, and wiring point** (`PE-101` / `DI_05` / `di05_photoeye`) but
**do not record a manufacturer or catalog number**. So there is no single "the" datasheet to cite, and
I will not invent one.

What *is* known about its kind:
- It is a **24 VDC photoelectric sensor** feeding a Micro820 digital input (`DI_05`), beam-broken = jam.
- The only sensor family named anywhere in the repo is an **Omron E3Z** (one passing mention). If the
  physical bench sensor is an E3Z, the datasheet is:
  `https://assets.omron.com/m/2e1e25a01b4d1a47/original/E3Z-Photoelectric-Sensors-Datasheet.pdf`
  (search "Omron E3Z datasheet"). **Treat this as representative, not confirmed.**
- In the Factory I/O visual layer this is a **diffuse / retro-reflective sensor** — see `../conveyor/`.

## To make this exact

Record the real PE-101 part number on the bench (sticker on the sensor) in this `notes.md`, then add
its datasheet `.url`. Until then this folder documents the **role + wiring**, not a specific product.
