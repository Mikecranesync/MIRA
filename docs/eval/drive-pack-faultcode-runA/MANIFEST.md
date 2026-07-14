# Run A baseline — hash manifest

- **Run:** A (frozen, immutable)
- **Subject:** IMPULSE G+ Mini fault-code baseline
- **Execution timestamp (UTC):** 2026-07-14T04:18:21Z
- **Commit SHA:** `db1177c90adc37c86e00d41dd79ac275754a1b84`
- **Branch at capture:** `HEAD`
- **Python:** 3.12.13  ·  **Platform:** macOS-26.3-arm64-arm-64bit
- **schema fault_codes annotation:** `dict[int, str]`
- **Pack versions:** GS10 v2, PF525 v2, PF40 v2
- **Hash algorithm:** sha256  ·  **Artifacts:** 10
- **Self-excluded (chicken-and-egg):** MANIFEST.json, MANIFEST.md, make_manifest.py

| Artifact | Bytes | sha256 |
|---|---|---|
| `BASELINE_REPORT.md` | 5939 | `1301f28cffd408ea63f458cc91d8ce3ef25ef082271cdf7ca7ae5fb25387572e` |
| `RUN_B_DESIGN.md` | 8238 | `e8fa018617f534744f8e252a7aee4a86009d22e310693cda11af0105c1d70dcc` |
| `env.json` | 620 | `1987b3b2ea950914a6d8843c75abfc715e071a118f32d31586c3059c83fb60e0` |
| `extractor_output/gplus_mini_pack_result.json` | 287 | `5eada1a4145f8bfd72559c79cd8bab78135b92d33e97e20b75232b2337b2ac19` |
| `extractor_output/loader_rejection.txt` | 281 | `ba045d20c845d9639b8eb596a78c02656f754b787f9833018c1239d87e7c283c` |
| `metrics.json` | 2039 | `f098d45399331253a7c04200a8ea841993b1071215c75431ef08012503ef6dc2` |
| `raw_inputs/NO_SOURCE_MATERIAL.md` | 3117 | `cfd62f2e47d03c7df5dc583c1c12f45427e8973b2f633bf5eeb8b15c74cf803b` |
| `raw_inputs/gplus_mini_faultcodes_synthetic_probe.json` | 1875 | `63f41efb43677d336315e3ab524f708e77f2f1c01b077e0a7ac5185e5901d7c6` |
| `run.log` | 2024 | `274771b2c8412460b53b5a96df3c926d4a098bdeb5bac1f32d7e0be59a7c5131` |
| `run_a_freeze.py` | 10433 | `f9ca5e5a8145f3584ff85b8e3871f10ab0f72778158319c9c48ff8f73e4aafe4` |

Verify: `cd docs/eval/drive-pack-faultcode-runA && shasum -a 256 <artifact>` and compare, or re-run `make_manifest.py` and diff MANIFEST.json (byte-identical on an unchanged tree).
