# ResponseBlock `data` payloads — `factorylm.cited-turn.v1`

Reference for the `data` dict on `mira-bots/shared/chat/types.py::ResponseBlock`.
PRD §6.1 requires these be documented and versioned before a renderer consumes
them. Builders live in `mira-bots/shared/chat/cited_turn.py`; the conformance
suite is `mira-bots/tests/test_cited_turn_contract.py`.

These keys were **not invented for this contract** — they are what the live
Slack, Google Chat, and Teams renderers already read. Anything new is additive,
so an existing renderer keeps working untouched.

## Payloads by block kind

| Kind | Keys | Notes |
|---|---|---|
| `header` | `text` | |
| `paragraph` | `text` | |
| `bullet_list` | `items: list[str]` | |
| `key_value` | `pairs: list[[key, value]]` | Slack caps display at 10 fields. |
| `button_row` | `buttons: [{label, action, value?, url?}]` | `action == "open_url"` uses `url`. |
| `citation` | see below | |
| `warning` | `text` | |
| `suggestion_chips` | `suggestions: list[str]` | Slack caps at 5. |
| `divider` | — | Presentational; no text equivalent. |
| `image` | `url`, `alt` | No renderer branch yet. |
| `code` | `code` | No renderer branch yet. |

### `citation`

| Key | Meaning |
|---|---|
| `v` | Contract version, currently `factorylm.cited-turn.v1`. |
| `source` | Flat one-line label. **What every current renderer draws.** |
| `source_type` | `manual`, `work_order`, `live_tag`, `kg`, `drive_pack`, `standard`, `technician`. |
| `label` | Human name, e.g. `GS10 user manual`. |
| `locator` | Page, section, work-order id, or tag + timestamp. **Required.** |
| `freshness` | `static`, `live`, `stale`, `simulated`, `unavailable`. |
| `status` | `verified`, `proposed`, or empty. |

`locator` is what makes a citation checkable rather than decorative, so
`cited_turn.build()` raises on a citation without one.

## Two behaviors worth knowing before you edit a renderer

**The plain-text fallback is derived, never hand-written.** `build()` composes
`NormalizedChatResponse.text` from the blocks. A block kind missing from
`_block_text` silently vanishes from the fallback, which is what a screen reader
and every unsupported surface actually receive.

**Every renderer ends with an empty-blocks rescue** (`if not blocks: emit
response.text`). That rescue makes an unsupported block kind look supported when
it is rendered on its own — the content appears, via the fallback, and a naive
test passes. The conformance suite therefore pairs each kind under test with a
paragraph anchor so the rescue cannot fire. This is not hypothetical: it hid the
fact that no renderer implemented `bullet_list`, which two turn states emit.

## Known gaps

`image`, `code`, and `suggestion_chips` (the last on Google Chat and Teams) have
no renderer branch. They are marked `xfail(strict=True)` in the conformance
suite, so implementing one turns the xfail into an unexpected pass and forces
the marker to be removed. No Cited Turn state emits them today.
