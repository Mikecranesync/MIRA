# QR identification link as a manual-search shortcut (research, 2026-11-01)

Issue: #5070. Status: research plus groundwork. No paid inference was used, and no QR link was opened.

## Question

Newer components often print a QR code on the nameplate that links to the maker's product page
or manual (IEC 61406 "Identification Link"). Does MIRA read these codes, and how much would they
help the manual-search route?

## Answer in one line

MIRA does not read them today, but they are worth reading. In our own photos, decodable codes are
mostly **DataMatrix codes carrying an exact order number**, not QR URLs. A useful decoder licensed
Apache-2.0 exists and runs in under 0.2 s per photo at p95.

## Where a nameplate photo enters today

| Entry point | File and line | Decodes codes? |
|---|---|---|
| Shared chat fast path (Slack and other normalized adapters) | `mira-bots/shared/chat/fast_paths.py:126` `_try_nameplate_drive_pack`, identity built at line 148 | no on main; this PR adds a decode behind `MIRA_QR_IDENTIFICATION_LINK` (default off) |
| Telegram nameplate fast path | `mira-bots/telegram/bot.py:1281` `_try_nameplate_drive_pack_reply`, identity at line 1325 | no |
| Slack file download | `mira-bots/slack/bot.py:163` `download_slack_file` (feeds the shared fast path) | no |
| Hub notebook nameplate recognize | `mira-hub/src/app/api/equipment-notebooks/[id]/nameplate/recognize/route.ts:52` | no (guarded legacy path) |
| Hub recognize-nameplate | `mira-hub/src/app/api/equipment-notebooks/recognize-nameplate/route.ts:20` | no (guarded legacy path) |
| Hub notebook look | `mira-hub/src/app/api/equipment-notebooks/[id]/look/route.ts` | no (guarded legacy path) |
| Ingest photo API | `mira-core/mira-ingest/main.py:562` `/ingest/photo` | no |
| Hub `/scan` page | `mira-hub/src/app/(hub)/scan/page.tsx` (BarcodeDetector `qr_code`) then `mira-hub/src/lib/scan-target.ts:10` `extractAssetTag` | QR yes, but keeps only FactoryLM `/m/<tag>` links |
| Mobile scan | `mira-mobile/src/screens/ScanView.tsx` (qr-scanner, MIT) then `AssetsTab.tsx:76` `onResult` | QR yes, FactoryLM tags only |

`AssetIdentityPacket.barcode_or_qr_payload` (`mira-bots/shared/drive_packs/asset_identity.py:88`)
already exists and nothing fills it.

The groundwork PR uses the **shared chat fast path** as its one entry point. It already holds the
image bytes, it is not a guarded legacy UI path, and Telegram can adopt the same helper later.

## Decoder choice (licence including native libraries)

| Candidate | Licence | Native payload | Verdict |
|---|---|---|---|
| zxing-cpp 3.1.1 (Python wheel) | Apache-2.0 | one `zxingcpp.abi3.so`, no Python dependencies | **chosen** |
| opencv-python-headless 5.0.0.93 | Apache-2.0 (wrapper) | bundles FFmpeg/libav and about 20 other dylibs (LGPL-family) | rejected: native licences |
| pyzbar / zbar | MIT wrapper, LGPL-2.1 zbar | libzbar | rejected: LGPL |
| qrcode (writer, tests only) | BSD | none | not needed; zxing-cpp writes test fixtures itself |

zxing-cpp reads QR, Micro QR and DataMatrix with one call and never needs a network.

## Census (decode only, local files, no network)

Script: decode-only, grayscale with EXIF orientation applied, plus a second pass at 2000 px for
large phone photos. Formats: QRCode, MicroQRCode, DataMatrix. Hosts were classified against the
48 hosts in `manual_search` `OEM_DOMAINS` plus `TRUSTED_DOMAINS`. Raw payloads and serial numbers
are not reproduced here (private photos).

| Set | Images | Opened | Any code decoded | Images with QR | Images with DataMatrix |
|---|---|---|---|---|---|
| Pixel industrial image set | 755 | 754 (1 HEIC failed to open) | 28 | 12 | 16 |
| 50-photo benchmark (a subset of the Pixel set) | 50 | 50 | 5 | 0 | 5 |

QR payload classes (Pixel set, 12 QR codes):

| Class | Count | Hosts |
|---|---|---|
| FactoryLM `/m/` tag | 0 | none |
| Manufacturer URL (host in the OEM list) | 0 | none |
| Other URL | 9 | `qr.bluewolfcalendars.com` 6 (maintenance calendars), `go2adc.com` 2 (AutomationDirect GS10 drives), `qr.creality.com` 1 (3D printer) |
| No URL | 3 | part and date strings (Schaltbau 2, S+S Regeltechnik 1) |

DataMatrix (16 images): **8 carry an ANSI MH10.8.2 `1P` supplier part number**, which is the exact
Siemens order number (SINAMICS, ET200SP, TP700, SITOP and similar). The other DataMatrix payloads
are numeric strings (Schneider, Danfoss and others).

Decode time per opened image: p50 0.084 s, p95 0.198 s, max 0.255 s (n = 754).

### Recall caveat

The dataset manifest mentions a code on 18 images. 8 of those decoded. 20 decoded images had no
mention. Of the 10 mentioned but not decoded:

- 4 are 1D barcodes (ITF, Code39, Code128), which are outside the scanned formats.
- 5 decode nothing in any format (glare, angle or size). This includes P1341, which was re-checked
  with all 2D and 1D formats and has no readable code.
- 1 is UNKNOWN: P1089 could not be checked because its file is not in the local copy of the set.

True QR recall is therefore UNKNOWN. Decoded counts are a lower bound.

## What the numbers mean

1. **The QR shortcut alone is rare in our photos.** 0 of 50 benchmark photos and 2 of 755 Pixel
   photos have a QR that points at a component maker, and both go to `go2adc.com`.
2. **`go2adc.com` is a gap.** It is AutomationDirect's short-link host but is not in
   `OEM_DOMAINS`, so it classifies as other URL. Adding it under AutomationDirect is a one-line
   follow-up.
3. **The bigger win is the DataMatrix `1P` order number.** It gives an exact model number with no
   OCR, from 8 of 755 photos. That is more than the QR URLs, and it feeds the existing make and
   model search directly.
4. **IEC 61406 adoption will grow.** The cost of reading is about 0.1 s and zero tokens, so the
   decode is worth running on every nameplate photo even at today's hit rate.

## Threat model

| Threat | Mitigation in the design |
|---|---|
| Swapped or forged sticker pointing at a look-alike site | QR is a **candidate only**. It never overrides the nameplate reading, and a URL is trusted only when its host passes `_is_oem_host` for the make the nameplate names. |
| Phishing or malware link | Never fetched in this slice. Later fetches go through the existing manual-search HEAD validation, `_is_denied` and `_ip_is_public` checks. |
| SSRF (private IPs, odd ports, credentials in the URL) | The classifier rejects non-https, user-info, non-443 ports, IP literals and denied hosts before any later fetch. |
| Redirect chains (short links) | Not followed here. A follow-up that resolves short links must re-check the final host. |
| Private data in payloads (serial numbers) | The payload is stored on the identity packet only, is not logged, and is not sent to any model. |

## Routing design

1. Decode codes from the nameplate photo (never raises; empty result on any error).
2. Classify each payload: FactoryLM tag, manufacturer URL, other URL or no URL; a `1P` value is
   extracted as a part-number candidate.
3. Fill `AssetIdentityPacket.barcode_or_qr_payload` behind `MIRA_QR_IDENTIFICATION_LINK`
   (default off).
4. `search_manual(..., identification_link=...)` adds the link as the top-ranked candidate only
   when it classifies as `oem_url` for the nameplate make. Queries still use the nameplate make and
   model, and the link must pass the same judge or HEAD validation as any hit. The manual-discovery
   endpoint passes the optional `identification_link` request field through only when the flag is
   on.
5. Follow-ups (#5071): the `1P` value as a model fallback, `go2adc.com`, Telegram adoption, Hub
   uploads, and #5073 (Slack hands the decoder its 512-pixel copy).

## Out of scope

Merge, staging enablement, opening or resolving QR URLs, Hub and mobile scan changes (guarded
legacy paths), and 1D barcodes.

## Appendix: per-test red evidence

Every test in `mira-bots/tests/test_identification_link.py` was made to fail by name on a
behaviour mutation of the code it protects (31 mutations, one at a time, full file run each
time, tree restored after each). The first test-first run against a raising stub, before the
code existed, gave 30 failed and 2 passed; the table below is the behaviour proof for all 41.

| Test | Behaviour mutation that turns it red |
|---|---|
| `test_classify_never_raises[]` | bad kind on non-string |
| `test_classify_never_raises[123]` | bad kind on non-string |
| `test_classify_never_raises[http://[bad]` | malformed URL raises |
| `test_classify_never_raises[https://]` | bad kind on empty netloc |
| `test_classify_never_raises[None]` | bad kind on non-string |
| `test_decode_never_raises_on_bad_input[]` | early return invents code |
| `test_decode_never_raises_on_bad_input[\x89PNG\r\n\x1a\n broken]` | decode swallow |
| `test_decode_never_raises_on_bad_input[None]` | early return invents code |
| `test_decode_never_raises_on_bad_input[not an image]` | decode swallow |
| `test_decode_reads_a_datamatrix_payload` | drop DataMatrix format |
| `test_decode_reads_a_qr_payload` | drop QR format |
| `test_decode_returns_empty_for_a_plain_image` | no-code invents code |
| `test_decode_returns_empty_when_decoder_missing` | drop QR format, early return invents code |
| `test_denied_host_is_denied_url` | deny check |
| `test_discovery_ignores_the_link_with_the_flag_off` | discovery flag |
| `test_discovery_passes_the_link_with_the_flag_on` | discovery drops link |
| `test_factorylm_asset_tag` | tag demoted |
| `test_factorylm_host_without_tag_path_is_other_url` | factorylm path |
| `test_flag_off_does_not_decode` | flag ignored |
| `test_flag_on_fills_payload_at_the_fast_path` | drop QR format, payload dropped |
| `test_flag_on_with_no_code_leaves_payload_none` | no-code invents code, no-code payload |
| `test_identity_packet_carries_the_payload` | packet carries |
| `test_identity_packet_without_payload_stays_none` | packet default |
| `test_identity_payload_never_overrides_the_nameplate_model` | payload->model |
| `test_link_for_another_make_never_enters_the_pool` | make gate, rank oem only |
| `test_link_is_returned_for_review_when_search_finds_nothing` | link pre-validated, oem demoted |
| `test_link_never_replaces_the_nameplate_search` | link pre-validated |
| `test_mh10_part_number_inside_iso15434_envelope` | part slice |
| `test_mh10_part_number_is_extracted` | bad kind on empty netloc, part slice |
| `test_oem_host_for_a_different_make_is_not_trusted` | make gate |
| `test_oem_host_for_the_named_make_is_oem_url` | oem demoted |
| `test_oem_host_with_no_make_is_not_trusted` | make gate |
| `test_plain_text_has_no_part_number` | bad kind on empty netloc, part from plain text |
| `test_trusted_identification_link_is_tried_first` | link pre-validated, oem demoted (+1 more) |
| `test_unsafe_urls_are_never_oem[http://www.automationdirect.com/gs10]` | https only |
| `test_unsafe_urls_are_never_oem[https://[::1]/gs10]` | ip literal |
| `test_unsafe_urls_are_never_oem[https://10.0.0.5/gs10]` | ip literal |
| `test_unsafe_urls_are_never_oem[https://user:pw@www.automationdirect.com/gs10]` | userinfo |
| `test_unsafe_urls_are_never_oem[https://www.automationdirect.com:80/gs10]` | port 443 |
| `test_unsafe_urls_are_never_oem[https://www.automationdirect.com:8443/gs10]` | port 443 |
| `test_without_a_link_the_search_hit_is_tried_first` | link always added |

41 tests, 41 with a behaviour red.
