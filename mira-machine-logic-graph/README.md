# mira-machine-logic-graph

Parses Micro800 (CCW) Structured Text programs and exposes their variable
graph as Ignition-importable tag JSON. Foundation for the future i3X
facade — tag payloads already carry `i3x.elementId` / `i3x.namespace` /
`i3x.displayName` metadata, ignored by Ignition Designer on import.

## Run

```bash
bun install
bun run dev               # http://localhost:8090
bun test
bun run tags:generate     # writes ../ignition/tags_micro800.json
```

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | liveness |
| GET | `/projects` | list registered PLC projects |
| GET | `/projects/:id` | project metadata + Ignition device config |
| GET | `/projects/:id/ignition-tags` | full Ignition tag export + i3X metadata (**CRA-235**) |

## Projects

Registered statically in `src/projects/registry.ts`. Today: one project,
`micro820-conveyor`, pointing at `plc/Prog2.stf` +
`research/variable-manifest.json`.

## Why a separate service

CCW stores the authoritative variable table in a binary `.accdb`. The
`.stf` file references those variables but does not declare them. This
service merges the two sources (ST identifier graph ∩ exported manifest)
into a single Ignition-ready payload, so demos do not depend on hand
maintenance of `tags.json`.

## Tag emission

For each variable that appears in the ST file **and** has a Modbus
address in the manifest:

- `COIL:N` → `ns=1;s=[<device>]C<N>` (`Boolean`)
- `HR:N`   → `ns=1;s=[<device>]HR<400000+N>` (`Int4`)
- `IR:N`   → `ns=1;s=[<device>]IR<300000+N>` (`Int4`)
- `DI:N`   → `ns=1;s=[<device>]DI<N>` (`Boolean`)

Tag names are PascalCase-mapped from the CCW global variable name. The
original variable name is preserved on `i3x.sourceVariable`.
