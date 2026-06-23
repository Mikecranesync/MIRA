# PLC — Allen-Bradley Micro820 `2080-LC20-20QBB`

**Asset:** the programmable controller that runs the Conv_Simple ladder/ST and masters the Modbus link
to the GS10.
**Identity (confirmed in repo):** Allen-Bradley **Micro820 `2080-LC20-20QBB`**
(`plc/GS10_Integration_Guide.md`: *"PLC: Allen-Bradley Micro820 2080-LC20-20QBB"*).

## Documents

- **`micro820-user-manual.url`** → Micro820 Programmable Controllers User Manual, Rockwell publication
  **`2080-UM005`**
  `https://literature.rockwellautomation.com/idc/groups/literature/documents/um/2080-um005_-en-e.pdf`
  If that direct link 404s (Rockwell migrates literature URLs), search the **publication number
  `2080-UM005`** at `https://literature.rockwellautomation.com`.
- Product page: `https://www.rockwellautomation.com/en-us/products/hardware/allen-bradley/programmable-controllers/micro-controllers/micro800-family/micro820.html`
- Instruction set reference: Micro800 General Instructions, publication **`2080-RM001`**.

## Why it supports this asset

`2080-LC20-20QBB` = Micro820, 20 I/O, 24 VDC in / relay out, embedded RS-485 (the serial port used for
Modbus RTU to the GS10). The user manual documents the serial port config (8N2, 9600 baud — matching
GS10 P09.04=13) and the MSG/Modbus instruction the Conv_Simple program uses (`plc/Prog_init_ConvSimple_v2.1.st`).
