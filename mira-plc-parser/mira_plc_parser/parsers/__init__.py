"""Per-format parsers. Each module exposes `parse(text: str, source_file: str) -> PLCProject` and a
`FORMAT` key, and targets the shared IR so the analysis layer is format-agnostic."""
