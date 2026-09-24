# LOOK conversation recall repair

PR #3968 originally indexed LOOK as an answered notebook turn. Independent review rejected that implementation: mobile did not propagate the selected thread, the empty answer rendered as “No answer.”, and tenant-deduplicated photo IDs could select another conversation’s newest description.

The repair associates the observation with notebook and thread in existing VisualSession metadata, with the existing server-derived creator as owner. It does not create an answered turn. The mobile adapter and Sensor LOOK pass the actual backend thread ID, separately from the shell’s presentation ID. Invalid thread IDs are rejected before parking the image.

Text-only follow-ups select the newest two distinct active, linked photos in that conversation. Description selection stays scoped to notebook, owner and thread. Existing actual photo-answer turns remain a compatibility source for pre-metadata observations. Historical unscoped records cannot retroactively prove a conversation association; that legacy fallback requires an answered turn with nonempty text, a current notebook photo link, and the same known observation owner. It is never used to discover standalone LOOKs. The existing explicit-current-photo path and file-wide sticky physical hazard policy are preserved.

A failed photo link does not create conversation-scoped memory, and current links are checked on recall. Observation storage remains fail-open for the LOOK response. No new table, migration, or independent observation store was introduced.

Validation:

- Round-two independent review found three fallback gaps. Five new negative controls failed before repair and pass afterward: synthetic/empty/unanswered rows, removed links, and another owner's legacy description.
- Red-first association controls reproduced the fake answered turn, wrong-conversation description, invalid thread and missing mobile propagation.
- Hub: 3,821 tests / 294 files passed.
- Mobile: 777 tests / 61 files passed; TypeScript and Vite build passed.
- Real disposable Postgres: 26 integration tests passed, including owner/notebook/thread/tenant isolation for reused photo bytes, active-observation filtering and linked-file eligibility.
- Hub TypeScript retains the same 76 file/code/message diagnostics as the equal-dependency main baseline; no new diagnostics. This is not a clean Hub typecheck claim.

Independent review, CI, physical Pixel journey and staging acceptance remain pending. This is code-level evidence only. Issue #3984 remains open and production is untouched.
