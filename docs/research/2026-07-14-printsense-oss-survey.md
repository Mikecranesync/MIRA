# PrintSense OSS survey — how others read engineering drawings with VLMs (2026-07-14)

> Four parallel research agents, verified-URL-only findings. Feeds the PATH_TO_A iteration
> loop. Recon companions (repo forensics) actioned same-day: Phase-2/3 recovery (#2699),
> per-section duplicate_identifier gate (#2701), on-the-job CLI (#2700).

## Surveyed four adjacent communities that turn line drawings into machine-readable structure: P&ID digitization (Digitize-PID, Azure-Samples, PID2Graph, pyDEXPI/DEXPI rule-graphs), schematic-to-netlist (Masala-CHAI, Netlistify, CircuitVision, SINA, CGHD), symbol detection on engineering drawings (Elyan/SiED), and LLM/VLM diagram benchmarks (EEE-Bench, Enginuity, PIDQA). The field has converged on a consistent architecture: deterministic CV for topology (lines/connectivity), a learned detector for symbols, and TEXT handled as a separate late "binding" problem (OCR string -> owner entity), with a rule-based domain-knowledge validation stage as the trust layer. Pure-VLM reading (our PrintSense approach) is the outlier, and the benchmarks name its exact weaknesses: "laziness" (text-prior shortcuts over pixels = our confident misreads) and a systematic identification-vs-description-fidelity gap (= our two-axis verdict, independently reinvented). Evaluation best practice is graph-native: match nodes first (Hungarian/tag match), then score edges between matched nodes, plus executable QA probes (Cypher over the emitted graph). EPRI/ABB industrial work is essentially closed (ABB lineage = Arroyo/Fay legacy-P&ID papers, no public code); the open proxies are Azure-Samples and PID2Graph. Local grounding: read printsense/grader.py + models.py in C:/wt-printsense (read-only) so recommendations target the actual rubric shape.

### [Digitize-PID + Dataset-P&ID (TCS Research, PAKDD 2021)](https://arxiv.org/abs/2109.03794) (verified)

**What:** End-to-end P&ID pipeline: kernel-based line detection, two-step fine-grained detection for near-identical complex symbols, text extraction, association of pipes/symbols/text, then a final VALIDATION-AND-CORRECTION stage driven by domain knowledge. Releases Dataset-P&ID: 500 synthetic annotated P&IDs (50+ symbol classes, noise variants) — the field's baseline dataset.

**Relevance to PrintSense:** Their explicit final pipeline stage — domain-rule validation and correction of the extracted structure — is the published precedent for our import gates; 'minute visual differences between symbols' is the P&ID analog of our digit-drift discipline. The synthetic-dataset-with-known-graph pattern is how everyone scales eval beyond hand-built rubrics.

### [Azure-Samples / digitization-of-piping-and-instrument-diagrams (Microsoft ISE)](https://github.com/Azure-Samples/digitization-of-piping-and-instrument-diagrams) (verified)

**What:** Production-shaped open sample (132 stars): symbol detection (AutoML) + OCR text detection + line detection + arrow-direction detection + graph construction into a node/edge graph where nodes are assets LABELED with their associated text. Ships per-stage design docs (text-association, line-detection, arrow-direction) documenting the spatial/semantic heuristics.

**Relevance to PrintSense:** The richest public writeup of the TEXT->SYMBOL association problem — they treat tag binding as its own pipeline stage with explicit spatial rules, not a side effect of detection. Steal the contract for our prompt: every read string must be bound to exactly one owner entity or explicitly declared unbound; their stage decomposition is also the reference architecture if we later add CV pre-passes.

### [PID2Graph / Relationformer P&ID digitization (DSAA 2025)](https://arxiv.org/abs/2411.13929) (verified)

**What:** Transformer (Relationformer) that JOINTLY extracts symbols (nodes w/ bboxes) and connections (edges) from P&IDs; +25% edge accuracy over the modular baseline. Releases PID2Graph on Zenodo (zenodo.org/records/14803338) — first public REAL-WORLD P&ID dataset with full-graph annotations. Text (CRAFT+EasyOCR) is used only to filter text regions out of line detection, not extracted.

**Relevance to PrintSense:** Two direct steals: (1) their edge-eval protocol — match ground-truth to predicted nodes first (bbox gIoU / for us, tag match), then compute edge precision/recall between MATCHED node pairs — is the missing edge-level axis for our grader; (2) their reported failure modes (symbol truncation at patch borders, 43% confusion in a catch-all 'general' class, duplicate-merge errors when stitching patches) are exactly the risks of any tile-based fix to our 2576px budget.

### [CGHD — Public Ground-Truth Dataset for Handwritten Circuit Diagrams (DFKI)](https://github.com/DFKI/cghd) (verified)

**What:** 3,173 hand-drawn circuit images with 246k PASCAL-VOC bounding boxes, 84k TEXT-string annotations with a role taxonomy (component characteristic vs terminal label vs text block), 40k rotation annotations, stroke segmentation maps, and LTspice ASC netlists for a subset. Companion pipeline paper (arxiv 2402.11093): detection -> segmentation -> HCR -> orientation regression -> graph assembly + rectification.

**Relevance to PrintSense:** The best-layered ground-truth format in the survey: bbox -> text ROLE -> rotation -> netlist. The text-role taxonomy is stealable tonight: our rubric pools all tags together, so 'right string, wrong role' (a wire number read as a device tag) currently scores as a hit. Rotation as a first-class annotation validates our 90°-rotation root-cause finding.

### [Masala-CHAI — large-scale SPICE netlist extraction from schematics (arxiv 2411.14299)](https://github.com/jitendra-bhandari/Masala-CHAI) (verified)

**What:** YOLO component detection + component-removal node mapping + GPT-4 netlist generation; V2 replaces single-pass with a 3-agent loop: Agent1 validates/corrects detector output, Agent2 traces connectivity and RUNS ngspice, a Judge verifies component completeness + simulation validity and feeds errors back for up to 2 bounded revisions. Ships 7,500 netlists from 10 textbooks; documents common LLM netlist errors fixed via prompt tuning.

**Relevance to PrintSense:** The strongest published pattern for our current blocker: a DETERMINISTIC verifier inside a bounded LLM revision loop. Our gates.py/grader are the ngspice analog — feed the specific gate violation (duplicate_identifier, dangling connects) back to Opus for at most 1-2 revisions instead of accepting FAIL. Their 'component completeness' judge check = a prose-vs-graph count-reconciliation gate.

### [Netlistify (NYCU-AI-EDA)](https://github.com/NYCU-AI-EDA/Netlistify) (verified)

**What:** Modular schematic-to-HSPICE framework (48 stars): YOLOv8 components + a dedicated ResNet ORIENTATION classifier + modified DETR for wire detection/connectivity. Releases 100k synthetic schematic images on HuggingFace plus pretrained weights.

**Relevance to PrintSense:** Orientation is modeled as its own predicted attribute — independent confirmation that rotation is a primary error source (our SCU2 misreads were a 90° rotation). Their 100k synthetic corpus shows the standard route to eval scale: render drawings from a known graph so ground truth is free.

### [CircuitVision](https://github.com/JKc66/CircuitVision) (verified)

**What:** YOLOv11 detection (mAP50 0.931) + SAM2 segmentation of conductive traces + pixel corner-finding node analysis to build a STRUCTURAL netlist first; Gemini OCR then enriches it with component values/types in a second stage. Includes fallback mechanisms and empty-coordinate sanity checks; filters invalid entries before declaring output SPICE-ready.

**Relevance to PrintSense:** Cleanest example of the two-stage 'topology without text, then text binding' decomposition — the same separation our two-axis verdict measures but enforced at generation time. Their filter-invalid-entries-before-output step is a cheap gate pattern: reject entities whose connects reference nothing.

### [SINA — circuit schematic image-to-netlist generator (arxiv, Jan 2026)](https://arxiv.org/abs/2601.22114) (verified)

**What:** Open-source pipeline: deep detection for components + Connected-Component Labeling for connectivity + OCR for reference designators + a VLM used ONLY for the designator-ASSIGNMENT decision. Reports 96.47% netlist accuracy, 2.72x over prior SOTA.

**Relevance to PrintSense:** Most recent evidence that the winning division of labor is deterministic CV for topology and VLM only for text-to-structure binding. Short-term prompt steal: make Opus justify each tag->device binding as a discrete, evidenced decision rather than emitting bindings implicitly inside entity JSON.

### [Eng_Diagrams / SiED — imbalanced P&ID symbol dataset (Elyan et al., RGU)](https://github.com/heyad/Eng_Diagrams) (verified)

**What:** 2,432 symbol instances from real P&IDs (74 stars), heavily class-imbalanced; CNN baselines plus MFCGAN (multi-fake-class GAN) to synthesize minority-class symbols. Companion papers use YOLO for detection on full drawings.

**Relevance to PrintSense:** Names the failure mode we'd hit scaling across prints: rare symbol/tag families get systematically misread and a single pooled F1 hides it. Steal per-class reporting: our grader already splits device/wire/xref — extend the report to flag any category with expected<=3 where a miss is invisible in the aggregate.

### [PIDQA — QA dataset over P&IDs with executable ground truth](https://github.com/mgupta70/PIDQA) (verified)

**What:** 64,000 question-answer pairs over the 500 Dataset-P&ID sheets in 4 categories (simple counting, spatial counting, spatial connections, value-based); every question ships with a ground-truth CYPHER query over the diagram's knowledge graph, so answers are verified by executing the query, not string match.

**Relevance to PrintSense:** The most stealable eval format found: derive counting/connectivity questions from rubric.json and answer them by DETERMINISTICALLY querying the emitted PrintSynthGraph ('how many conductors land on -X4?', 'what is at the far end of -W5497?'). Catches structurally-wrong graphs that still pass tag-pool F1 — our device-F1 0.80 plateau is exactly where this axis adds signal.

### [EEE-Bench (CVPR 2025)](https://arxiv.org/abs/2411.01492) (verified)

**What:** 2,860 multimodal electrical/electronics engineering problems across 10 subdomains (circuit theory, analog, power electronics, control...). Evaluated 17 LLMs/LMMs: 19.5-46.8% average. Key finding: 'laziness' — LMMs shortcut by trusting accompanying TEXT and ignoring the visual when reasoning about technical images.

**Relevance to PrintSense:** 'Laziness' is the named mechanism behind our confident misreads: the model completes a plausible tag from priors instead of reading pixels. Mitigation to steal for evals: adversarial premise probes — ask about a tag that does NOT exist on the sheet (-W5498 when the print shows -W5497); a trustworthy interpreter must contradict the premise from the image, not comply.

### [Enginuity — VLM benchmark on engineering diagrams from military service manuals (arxiv, Jun 2026)](https://arxiv.org/abs/2606.03410) (verified)

**What:** First open VLM benchmark on real service-manual engineering diagrams: (1) structured parts-table extraction, (2) free-form diagram VQA. Frontier models (incl. GPT-5.2, Claude Opus 4.7) locate parts well (Recall@all 0.61-0.87) but fail description fidelity (Token F1 0.03-0.18). Releases dataset, annotations, eval harness, AND per-sample model outputs. Finds token-overlap metrics under-report technical-description quality 2-6x vs semantic judging.

**Relevance to PrintSense:** Independent, current-frontier confirmation of PrintSense's two-axis thesis: identification and faithful description are DIFFERENT capabilities and must be scored separately (good prose != trustworthy graph, measured). Two hygiene steals: publish per-sample outputs beside scores in benchmarks/, and never use token overlap on the prose axis — keep deterministic points on tags/structure only (our grader already does this; don't drift).

### [Rule-based autocorrection of P&IDs on graphs + pyDEXPI (Process Intelligence Research, RWTH)](https://github.com/process-intelligence-research/pyDEXPI) (verified)

**What:** pyDEXPI: open-source Pydantic implementation of the DEXPI P&ID standard — Proteus XML loader, NetworkX graph parser (equipment/instrumentation/piping as nodes, piping+signal connections as directed edges), SVG export, and a SYNTHETIC DEXPI P&ID generator for AI training. Companion paper (arxiv 2502.18493, verified): 33 engineering rules encoded as rule-graphs detect AND correct errors on the P&ID graph.

**Relevance to PrintSense:** The closest published analog to PrintSynthGraph + gates.py: typed Pydantic diagram model + graph view + rule library on top. Steal rule categories as new import gates (dangling connection, incompatible endpoint types, orphan node); their synthetic-generator pattern is the later route to IEC-print eval scale. DEXPI itself is proof the industry endgame is a typed exchange graph, not boxes.

### [XML-driven LLM diagram understanding (arxiv 2502.04389)](https://arxiv.org/abs/2502.04389) (verified)

**What:** Proof-of-concept showing VLMs still fail at extracting diagram structures/relationships; instead extracts shape + text metadata directly from editable source files (xlsx/pptx) and lets a text LLM reason over the structured metadata — outperforming VLM pixel-reading on relationship questions.

**Relevance to PrintSense:** When a customer has EPLAN/CAD/editable source rather than a scan, parse the source and skip vision entirely — same trust ladder, higher floor. Also supports our render/QA direction: once the typed graph exists, downstream questions should be answered FROM the graph, never by re-reading the image.

### [ChatP&ID — GraphRAG over engineering diagrams (arxiv, Mar 2026)](https://arxiv.org/pdf/2603.22528) (UNVERIFIED — treat as lead only)

**What:** Enables LLM interaction with P&IDs by building a graph from the diagram and running graph-RAG over it (found via search; not fetched — listed for completeness).

**Relevance to PrintSense:** Downstream consumption pattern for an approved PrintSynthGraph: technician Q&A served by graph retrieval with citations back to sheet regions — aligned with MIRA's grounded-agent wedge; low priority for the current grading work.

### Adoptable tonight (hours, no heavy deps)

- Edge-level F1 in the grader (PID2Graph protocol): match rubric entities to emitted entities by normalized tag FIRST, then score `connects` pairs as edges between matched entities (precision/recall/F1). Pure-python grader.py extension + an `edges` section in rubric.json; closes the gap where tag-pool membership passes but the wiring is wrong — likely the honest explanation of device F1 0.80 stalling below strict-A.
- Bounded self-correction loop using EXISTING gates (Masala-CHAI judge pattern): after interpret, run gates.py + grader deterministically; on a gate violation (e.g. the current duplicate_identifier FAIL) send one revision prompt quoting the exact violations ('-X and -X share a tag: re-read one or mark UNREADABLE'), max 2 iterations, same Opus call shape. Deterministic-verifier-in-the-loop is the field's proven fix for LLM netlist errors.
- New deterministic gates from the P&ID rule-graph playbook (pyDEXPI/2502.18493 + Digitize-PID validation stage): (a) IEC tag-grammar regex lint per entity class (wires -W\d+, devices like -21/A13, xrefs \d+\.\d+); (b) cross-ref closure — every off_page_reference targets a sheet/column that exists in the package; (c) connects-target-exists — every connects string resolves to a declared entity/terminal tag or fails the gate; (d) count reconciliation — device count claimed in TechnicianBrief prose equals device count in the graph.
- Adversarial premise probes vs 'laziness' (EEE-Bench): add eval questions that presuppose a WRONG tag ('trace -W5498') — score PASS only if the interpreter contradicts the premise from the image. Directly targets the text-prior shortcut mechanism behind confident misreads; pure eval-case addition.
- QA probes generated from rubric.json (PIDQA format): auto-generate counting + connectivity questions whose answers are computed from the rubric ('how many conductors land on -X4?'), then answer them by deterministically querying the EMITTED PrintSynthGraph (dict walk, no Cypher needed). Graph-executable QA catches structural errors invisible to tag F1; ~50 lines of python, no deps.
- Text-ROLE taxonomy in the rubric (CGHD): tag each expected string with its role (device-tag / terminal / wire-number / xref / free-text) and score 'right string, wrong section' as a distinct error class instead of a pooled-set hit — tightens what the _structured_tag_pool currently blurs across sections.
- Evidence-enforcement rule in the grader (Enginuity + EEE-Bench): any confident (proposed) entity whose `evidence` field is empty or does not quote an on-sheet string gets its confidence treated as below the gate (counts toward unresolved, not asserted). Uses fields already in models.py; also adopt Enginuity's hygiene of committing per-sample model outputs beside scores in benchmarks/.

### Adoptable later

- Deterministic topology pre-pass (SINA/CircuitVision/Azure architecture): binarize sheet -> connected-component labeling / line detection to extract wire runs, then have the LLM only BIND read tags to the extracted topology. Requires OpenCV-class deps + tuning; the field's consistent 2-3x accuracy lever.
- Fine-tuned symbol detector on IEC symbols (YOLO-class) with minority-class handling (Elyan MFCGAN), feeding cropped per-symbol evidence to the LLM (Masala-CHAI/Netlistify pattern) instead of one whole-sheet image.
- Patch + stitch high-res reading to beat the 2576px budget — with PID2Graph's documented failure list as the test plan (symbol truncation at patch borders, duplicate-merge at stitch time, large symbols spanning patches).
- Orientation as a first-class predicted attribute per symbol/text region (Netlistify ResNet head; CGHD rotation annotations) — generalizes the one-off Tesseract-OSD auto-upright fix to per-region rotation.
- Synthetic IEC-print generator for eval scale (Dataset-P&ID / Netlistify-100k / pyDEXPI synthetic-generator pattern): render sheets from a known PrintSynthGraph with noise/rotation/scan artifacts so rubric ground truth is free and the grader gets hundreds of cases instead of hand-built ones.
- Machine-verification for trust promotion (ngspice analog from Masala-CHAI): electrical continuity/path checks over the typed graph (functional_paths replay, PE-bond closure) as the deterministic evidence justifying proposed -> machine_verified in the TrustState ladder.
- DEXPI-style exchange alignment + rule-graph autocorrection library: NetworkX export of PrintSynthGraph, a versioned rule library (pyDEXPI as reference implementation), and a GraphRAG/Cypher QA surface over approved graphs (ChatP&ID/PIDQA demo pattern) for technician-facing Q&A with citations.
- Out-of-domain regression fixtures from public datasets (CGHD ASC netlists, PID2Graph Zenodo, Enginuity harness + per-sample outputs) to sanity-check the interpreter's graph emitter against ground truth we didn't author.

## How frontier labs and open-source VLMs tile/slice large high-detail images (engineering drawings, documents) for vision-LLM reading — tile geometry, overlap %, overview images, cross-tile dedup — mapped onto printsense's single-2576px-image → 2x2+overview Phase-2

### [Anthropic Vision docs — image limits, multi-image, resolution tiers](https://platform.claude.com/docs/en/build-with-claude/vision.md) (verified)

**What:** Authoritative limits for the exact model printsense calls (claude-opus-4-8). High-res tier (Opus 4.8/4.7, Sonnet 5, Fable 5): max long edge 2576px AND max 4784 visual tokens, where tokens = ceil(w/28) x ceil(h/28) (28x28-px patches). Standard tier: 1568px / 1568 tokens. Up to 100 images/request (200k models; 600 otherwise), 8000x8000 max dims, 10MB/image. If a request has >20 images, a stricter per-image limit (~2000px per side) applies. Multi-image best practice: put images BEFORE text and label each with a short text block ('Image 1:', 'Image 2:') so the prompt can reference them. Quality guidance explicitly says 'Consider pre-resizing your images, cropping them, or both' and warns that repeated lossy JPEG passes hurt text legibility.

**Relevance to PrintSense:** Defines the tile budget: each tile can carry up to 4784 tokens, so a 2x2 grid + overview (5 images, all <=20) is fully supported in one request. The 4784-token cap (not just 2576px) is the real ceiling — printsense's current long-edge-only resize misses it. Label-every-image and images-before-text are the prompt structure the Phase-2 request should copy.

### [Anthropic Coordinates & resizing doc — exact resize algorithm + crop-and-offset recipe](https://platform.claude.com/docs/en/build-with-claude/vision-coordinates.md) (verified)

**What:** Gives the exact server resize rule with a Python reference implementation: largest aspect-preserving size where each side (rounded up to a multiple of 28) <= max_edge AND ceil(w/28)*ceil(h/28) <= max_tokens (2576/4784 high-res tier), found by binary search; images are then padded to 28-px multiples on bottom/right (padding never shifts coordinates). Key example: a 1075x1520 A4 scan is under the standard 1568px edge cap but still downscaled because it costs 2145 tokens. Best practices: pre-resize client-side so coordinates map 1:1; ask for ABSOLUTE PIXEL coordinates (never normalized 0-1000 — Claude does poorly with those); for fine/small targets 'crop the region of interest and send the crop (offset returned coordinates by the crop origin)'.

**Relevance to PrintSense:** This is Anthropic's own crop-and-stitch doctrine: crops at native resolution + client-side offset math is the sanctioned way to read fine detail. The resized_size() reference implementation is copy-pasteable into preprocess.py to size both the single image and tiles exactly to what the server will accept without further downscaling. Also fixes a latent bug: a portrait/square sheet at 2576px long edge exceeds 4784 tokens and is silently downscaled today.

### [OpenAI images & vision guide — the original overview+tiles recipe (GPT-4V/4o lineage)](https://developers.openai.com/api/docs/guides/images-vision) (verified)

**What:** OpenAI's server-side high-detail pipeline: scale image to fit 2048x2048, then scale shortest side to 768px, then split into NON-overlapping 512x512 tiles. Cost = 85 base tokens for an always-included low-res overview + 170 tokens per 512px tile. detail=low sends only the 512px overview; a newer 'original' detail level preserves input dimensions. Up to 1500 images/request.

**Relevance to PrintSense:** The canonical frontier-lab pattern printsense Phase-2 mirrors: a cheap global overview is ALWAYS included alongside detail tiles — the overview provides layout/global context, tiles provide legibility. Note OpenAI uses zero overlap because tiles+overview go to one model call that fuses them — same situation as sending overview+4 tiles in one Claude request.

### [Gemini image understanding docs — 768px tiling with crop-unit formula](https://ai.google.dev/gemini-api/docs/image-understanding) (verified)

**What:** Gemini server-side tiling: images with both dims <=384px cost a flat 258 tokens; larger images are cut into 768x768 tiles at 258 tokens each. Tile count derives from a crop-unit: roughly floor(min(w,h)/1.5), e.g. 960x540 -> crop unit 360 -> 3x2 = 6 tiles. Max 3600 image files/request.

**Relevance to PrintSense:** Second frontier lab independently converging on tiles + adaptive tile count keyed to image dimensions. The crop-unit idea (tile size derived from the image's short side, not fixed) is a lighter-weight alternative to InternVL's grid enumeration if printsense later replaces the fixed 2x2.

### [InternVL 2.x dynamic_preprocess — the reference open-source dynamic tiling implementation](https://internvl.readthedocs.io/en/latest/internvl2.0/quick_start.html) (verified)

**What:** dynamic_preprocess(image, min_num=1, max_num=12, image_size=448, use_thumbnail=False): enumerates all grid shapes (i,j) with min_num <= i*j <= max_num, picks the grid whose aspect ratio is closest to the image's (ties broken toward more tiles when the image area justifies it: area > 0.5 * 448^2 * i * j), resizes the image to exactly grid_w*448 x grid_h*448, crops NON-overlapping 448x448 tiles, and appends a 448x448 downsampled THUMBNAIL of the whole image whenever more than one tile was produced. If the image is small, 1 tile (no tiling).

**Relevance to PrintSense:** The most-copied open-source tiling recipe (InternVL, and derivatives across HF). Three transferable rules: (1) skip tiling when the image fits one tile's budget; (2) choose the grid by aspect-ratio match so tiles aren't distortion-prone slivers; (3) always append the global thumbnail when tiled. Zero overlap works for them because the LLM fuses all tiles in one context — printsense sending overview+tiles in one Claude request is the same regime, but a small overlap is still cheap insurance since Claude wasn't trained on this specific grid.

### [MiniCPM-V — LLaVA-UHD-style adaptive slicing at scale](https://github.com/OpenBMB/MiniCPM-V) (verified)

**What:** Handles images up to 1.8M pixels (any aspect ratio) via adaptive slicing based on the LLaVA-UHD architecture. max_slice_nums defaults to 9; docs recommend up to 36 slices for maximum detail on large images. Uses aggressive visual-token compression (4x/16x) so slicing stays affordable; slicing preserves a global view for context.

**Relevance to PrintSense:** Confirms the 9-12 slice practical band as the open-source default, with 36 as the extreme for dense documents — i.e., printsense's 4-tile plan is conservative and safe; pushing past ~9-12 tiles is where open models see diminishing returns per added token. Also evidence that slice count should scale with image megapixels, not be hardcoded.

### [LLaVA-UHD (arXiv 2403.11703) — variable-sized slices, native aspect ratio](https://arxiv.org/abs/2403.11703) (verified)

**What:** Image modularization strategy dividing native-resolution images into smaller VARIABLE-SIZED slices for efficient, extensible encoding (no distortion-inducing forced square resize), plus a compression module condensing visual tokens. Supports 672x1088 (6x the pixels of the 336x336 baseline) using only 94% of the baseline inference compute. Slice-level overlap/overview details live in the full paper, not the abstract.

**Relevance to PrintSense:** The academic root of the MiniCPM-V slicing family. Its core argument for printsense: never distort aspect ratio to hit a tile size — pick slice boundaries that keep native proportions (schematic symbols and text are aspect-sensitive). Supports cropping from the original rather than resizing to a fixed square.

### [Qwen2-VL naive dynamic resolution — the no-tiling counterpoint](https://huggingface.co/docs/transformers/en/model_doc/qwen2_vl) (verified)

**What:** Processes images at NATIVE resolution mapped to a dynamic number of tokens (28-px patch factor; M-ROPE). No tiling at all. Processor exposes min_pixels (default 56*56) and max_pixels (default 28*28*1280 ≈ 1.0MP) as a token budget; examples show raising to 2048*2048 or tuning 256*28*28..1024*28*28 to trade cost vs detail.

**Relevance to PrintSense:** Two lessons: (1) Claude's 28-px patch scheme is the same architecture family — Claude Opus 4.8 IS effectively a native-dynamic-resolution model up to 4784 tokens, so tiling's only job is to exceed that per-image budget by splitting the sheet across several images; (2) the min/max_pixels knob pattern maps directly to making PRINT_VISION token budget (not px) the config knob in preprocess.py.

### [SAHI (obss/sahi) — slicing-aided inference: the dedup/overlap gold standard](https://raw.githubusercontent.com/obss/sahi/main/sahi/predict.py) (verified)

**What:** Verified defaults from source: overlap_height_ratio=0.2, overlap_width_ratio=0.2 ('overlap of 0.2 for a window of size 512 yields an overlap of 102 pixels'), slice 512x512 (predict), auto_slice_resolution=True, perform_standard_pred=True ('a standard [full-image] prediction on top of sliced predictions to increase large object detection accuracy'), postprocess_type='GREEDYNMM' with match_metric='IOS' and match_threshold=0.5. Per-slice detections are shifted back to full-image coordinates then greedily merged.

**Relevance to PrintSense:** The detection-world consensus for overlapped tiling: 20% overlap + shift-to-global-coords + IoS-based greedy merge + ALWAYS keep a full-image pass for objects bigger than a tile. For printsense the analogs are: 10-20% tile overlap so every tag/symbol appears whole in >=1 tile; the overview call is the 'standard pred' that catches sheet-spanning objects (bus lines, off-page refs); and merge-by-identifier plays the role of NMS since PrintSynth entities are keyed by tag, not bbox.

### [P&ID digitization with Relationformer (arXiv 2411.13929) — measured tiling parameters on real engineering drawings](https://arxiv.org/html/2411.13929v1) (verified)

**What:** Digitizes P&IDs into graphs: full diagrams resized to 4500x7000 are split into 1500x1500 patches with AT LEAST 50% overlap. Merge pipeline: (1) decay each box's confidence by distance to the patch border (border detections are least trustworthy), (2) filter low-confidence, map boxes to full-image coordinates, (3) NMS at high IoU to kill duplicates, (4) weighted-box fusion at lower IoU to combine survivors, (5) drop self-loops/disconnected nodes. Ablations: growing patches from 1500 to 2000px dropped symbol detection >=10% (symbols become relatively smaller); stitching patches improved node AP +9.45% but cost edge mAP -4.91% on synthetic data.

**Relevance to PrintSense:** Closest published analog to printsense (drawing -> typed graph). Three hard-won lessons: (a) entities read near a tile border are the least reliable — prefer the copy read farther from the edge when merging; (b) relationships/edges (conductors, cross-refs) degrade under tiling even as node detection improves — keep the overview as the authority for connectivity and use tiles for tag legibility; (c) there is a measurable accuracy cliff from making tiles too large relative to symbol size.

### [mPLUG-DocOwl 1.5 (arXiv 2403.12895) — document-domain cropping + layout-preserving token merge](https://arxiv.org/abs/2403.12895) (verified)

**What:** OCR-free document understanding built on shape-adaptive cropping of high-res document pages (crop grid chosen to match page shape; details in full paper) with the H-Reducer module that preserves LAYOUT information while merging horizontally adjacent visual patches via convolution. Abstract verifies the layout-preservation design goal; crop-cell counts (448px cells, global image) are in the paper body.

**Relevance to PrintSense:** The doc-AI branch of the same convergent design: shape-adaptive crops + a global page view, with explicit care that merging never destroys spatial layout. Reinforces that printsense tile labels should state each tile's position in the sheet (row/col + crop box) so the model can reason about layout across tiles the way H-Reducer preserves it architecturally.

### Adoptable tonight (hours, no heavy deps)

- Replace the naive 2576-long-edge resize in printsense/preprocess.py with Anthropic's exact resized_size() rule (Python reference implementation is in the vision-coordinates doc, MIT-copyable, pure math + Pillow): fit BOTH max_edge=2576 and ceil(w/28)*ceil(h/28) <= 4784 tokens. Today a portrait or square sheet at 2576px long edge exceeds 4784 tokens and is silently server-downscaled — the sheet-20 landscape case is near the cap (2576x~1800 ≈ 6072 tokens -> ~11% hidden linear downscale). This alone recovers resolution on the existing single-image path with no tiling.
- Cut tiles from the ORIGINAL decoded image (before any downscale and before the JPEG q95 re-encode), not from the already-resized 2576px output: tiling downscaled pixels wastes the whole point, and re-encoding an already-encoded JPEG adds a second lossy pass the Anthropic docs explicitly warn degrades small text. Pipeline order: decode -> auto-upright -> crop tiles from full-res -> per-tile resized_size(2576, 4784) -> single JPEG q95 encode each.
- Tile geometry for Phase-2: keep 2x2 + overview, sized by token budget. Overview = full sheet through resized_size (<=4784 tokens). Each tile = quadrant + overlap, then resized_size per tile. Skip tiling entirely when the original sheet already fits in 4784 tokens un-downscaled (InternVL min_num=1 behavior) — tiling a small image only adds cost and duplicate risk.
- Overlap: use 12-15% of tile width/height with a floor of ~150px at native scan resolution, and assert overlap >= 2x the tallest symbol+label block you expect (~100-200px on these scans). Rationale: SAHI's cross-domain default is 0.2 (102px at 512 tiles); the P&ID Relationformer paper used >=50% but that's for per-patch independent detection — printsense sends all tiles in ONE request where Claude fuses context, so overlap only needs to guarantee every tag/symbol appears WHOLE in at least one tile, not to feed a geometric NMS. 0.5 overlap would double token cost for nothing here.
- Request structure (one API call, not per-tile calls): content = [text 'Image 1: full-sheet overview, downscaled', overview image, text 'Image 2: tile row 1 col 1 = top-left region, crop box (x0,y0)-(x1,y1) of the WxH original, overlaps neighbors by Npx', tile image, ... , final text prompt]. This is verbatim Anthropic multi-image guidance (label every image, images before text) and mirrors the GPT-4V/InternVL/Gemini overview+tiles pattern. 5 images stays far under the 20-image threshold where the ~2000px per-image clamp kicks in.
- Prompt addition for seam handling (system or user text, ~5 lines): tell the model the tiles overlap, that an entity visible in two tiles is THE SAME entity and must be emitted once, and that a designation cut off at a tile edge must not be pattern-completed — read it from the tile where it appears whole (it will, given the overlap), or emit UNREADABLE. This extends the existing character-level reading discipline to the tiled layout.
- Python-side identifier dedup in the merge/validate step (also fixes the CURRENT duplicate_identifier gate FAIL on the single-image path): normalize each entity tag (strip whitespace, unify unicode dashes, casefold) and merge entities sharing (entity_type, normalized_tag) — keep the copy with higher confidence / richer evidence, union relationships, and if two copies disagree on attributes demote to unresolved instead of keeping both. This is SAHI's GREEDYNMM translated from bbox-IoS space to identifier space, and it is required regardless of tiling because the gate already fails today.
- Prefer-center rule when duplicates conflict (borrowed from the P&ID paper's border-distance confidence decay): if the model reports which image an entity was read from (add an optional source_image index to evidence), prefer the read from the tile where the entity is NOT at the border; entities only seen at tile edges get a confidence haircut before the 0.55 CONF_GATE. Cheap to implement (string field + one comparison), directly targets confident-misreads at seams.

### Adoptable later

- Two-pass agentic zoom (Anthropic's own crop-and-offset recipe): pass 1 = overview only; the model returns unresolved items with approximate absolute-pixel bounding boxes (ask for pixel coords + structured output — never normalized coords, per the coordinates doc); pass 2 = native-resolution crops of exactly those regions, offsetting any returned coordinates by the crop origin. Fits printsense's existing unresolved/crop-request design and beats fixed grids on sparse sheets.
- Coordinate-grounded dedup: request an approximate [x1,y1,x2,y2] pixel bbox per entity per tile, shift by each tile's crop origin into sheet coordinates, then resolve conflicts geometrically (SAHI: IoS >= 0.5 = same entity; P&ID paper: NMS then weighted-box fusion). Enables detecting the nastiest error class — two tiles reading DIFFERENT tags at the SAME location = a confident-misread candidate for the grader.
- Overlap-zone cross-validation as a free consistency check: entities that fall inside the overlap band should be read identically by both adjacent tiles; a disagreement (tag mismatch, digit drift) auto-demotes to UNREADABLE/unresolved. Turns the overlap from redundancy into a measurable misread detector that feeds the deterministic grader.
- Shape-adaptive grid selection replacing fixed 2x2 (InternVL's algorithm, ~40 lines): enumerate (i,j) grids up to max_num=6-9 tiles, pick the grid minimizing aspect-ratio mismatch with the sheet, tie-broken by resolution utilization; tile count scales with original megapixels (Gemini's crop-unit formula is the lighter alternative). Cap well below the 9-12 tile band where MiniCPM-V/InternVL ablations show diminishing returns, and remember the P&ID finding that relationship extraction DEGRADES with more fragmentation — keep the overview authoritative for connectivity.
- Edge-aware graph merge for relationships: the P&ID paper's stitched-vs-patched result (+9.45% node AP, -4.91% edge mAP) predicts printsense's conductor/cross-reference edges will suffer under tiling. Later phase: take nodes (devices/terminals) from tiles, but reconcile edges (conductors, off-page refs) against the overview pass — union only edges whose endpoints both survived dedup, flag tile-only edges crossing seam boundaries for review.
- Cost/scale plumbing once tiling ships: token-count each composed request with the ceil(w/28)*ceil(h/28) formula before sending (pure math, no API call needed for images), enforce a per-sheet visual-token budget (e.g. 24k ≈ overview+4 native tiles ≈ 5x current cost), and run the benchmark corpus through the Message Batches API at 50% price for eval campaigns.

## Open-source OCR + auto-upright for dense small rotated text on white line art, filtered against the REAL dev box (Windows, py -3 = 3.14.2, Pillow 12.1.1 + OpenCV 4.13 present, no Tesseract binary, onnxruntime absent but 1.27.0 ships cp314 win_amd64 wheels; py 3.11.9/3.12.12 also on the launcher) and MIRA hard constraints (Apache/MIT only — blocks Surya weights; no TensorFlow — blocks eDOCr code). Q1 VERDICT: PIL ImageOps.exif_transpose is the correct free step 0 but NOT sufficient alone — (a) Telegram bot 'photo' uploads are re-encoded with orientation baked/stripped so it no-ops there (preprocess.py's own docstring observes this), (b) top-down bench shots are the classic EXIF failure: with the phone flat, the accelerometer cannot sense rotation about the vertical axis so the orientation tag is arbitrary, (c) EXIF never captures the print being sideways IN the frame. Cheapest reliable pip-only auto-upright = exif_transpose first, then rapid-orientation (RapidAI ONNX port of PaddleClas PULC text_image_orientation: 0/90/180/270, 6.5MB, Apache-2.0, opencv+onnxruntime only) gated on its score exactly like the existing OSD_MIN_CONF — a drop-in _auto_upright twin that works where Tesseract OSD currently no-ops. Q2 VERDICT: yes, high value per cost — a deterministic OCR token set is a second opinion the grader philosophy already wants: fuzzy-match Opus device-tag reads against OCR tokens to flag confident_misreads candidates, and corroborate duplicate_identifier using OCR box coordinates (two distinct boxes with the same string = true sheet duplicate, not an LLM double-read); treat disagreement as flag-for-review, never auto-fail (OCR has its own misses on line art). Small rotated tag text leader = the PP-OCR family (PP-OCRv5/v6: three-stage det+cls+rec, documented rotated-text robustness, 'industrial text' improvements, 5M-param tech report claims VLM-competitive with fewer hallucinations); its pip-only proxy is RapidOCR (bundled PP-OCRv6-small ONNX). EasyOCR is the niche alternative when you want rotation_info=[90,180,270] + allowlist (constrain charset to A-Z0-9-/.) for vertical tag labels, at the cost of a torch install and per-angle recognizer reruns.

### [rapid-orientation / RapidOrientation (RapidAI)](https://github.com/RapidAI/RapidOrientation) (verified)

**What:** Pip package classifying text-image orientation into 0/90/180/270 using PaddleClas PULC text_image_orientation converted to ONNX; 6.5MB model bundled in the wheel; deps = OpenCV + onnxruntime; Apache-2.0; returns (label, score); also verified on PyPI (v0.0.11, Feb 2026, Requires-Python >=3.6,<3.13).

**Relevance to PrintSense:** THE pip-only replacement for Tesseract OSD in printsense/preprocess.py _auto_upright on the dev box where the binary is missing. Same contract: probe downscaled image, gate on confidence score, rotate full-res. Caveat: <3.13 metadata pin vs py 3.14.2 — use --ignore-requires-python (pure-python pkg, deps satisfied), vendor the ~100-line inferencer + .onnx, or run in a py -3.11 venv.

### [onnxruntime (cp314 wheels confirmed)](https://pypi.org/project/onnxruntime/) (verified)

**What:** ONNX inference runtime; v1.27.0 (June 2026) ships onnxruntime-1.27.0-cp314-cp314-win_amd64.whl; Requires-Python >=3.11.

**Relevance to PrintSense:** The single new dependency needed for content-based upright (and RapidOCR cross-check) on the py 3.14.2 dev box — pip-only install verified possible.

### [Pillow ImageOps.exif_transpose](https://pillow.readthedocs.io/en/stable/reference/ImageOps.html) (verified)

**What:** Transposes an image per its EXIF Orientation tag (any value other than 1) and removes the orientation data; in_place option.

**Relevance to PrintSense:** Zero-install step 0 for auto-upright (Pillow 12.1.1 already present). Necessary but not sufficient: Telegram photo-path bakes/strips EXIF, flat top-down bench shots carry wrong/absent orientation, and content rotation is invisible to EXIF — hence pair with rapid-orientation. Currently NOT called in preprocess.py at all.

### [RapidOCR](https://github.com/RapidAI/RapidOCR) (verified)

**What:** Apache-2.0 offline OCR: PaddleOCR models converted to ONNX; `pip install rapidocr onnxruntime`; Windows/Linux/Mac; bundles PP-OCRv6_det_small + PP-OCRv6_rec_small in the wheel (PP-OCRv5 selectable via config); docs at rapidai.github.io/RapidOCRDocs verified; Requires-Python >=3.6,<3.13.

**Relevance to PrintSense:** Best pip-only deterministic second-opinion engine for cross-checking Opus tag reads (Q2): one pass yields token set + boxes + confidences for the grader gates. Risk on py3.14: pyclipper dep may lack cp314 wheels — fall back to py -3.11 venv (present on the box) or the bot container.

### [PaddleOCR 3.x / PP-OCRv5](https://github.com/PaddlePaddle/PaddleOCR) (verified)

**What:** Apache-2.0, v3.7.0 (June 2026); three-stage det+orientation-cls+rec pipeline; python 3.8–3.12 incl. Windows but requires the paddlepaddle framework (heavy); PP-OCRv5 beat PP-OCRv4 by ~13pts on OmniDocBench; release notes cite major improvements on digital displays, dot-matrix and industrial text; optional doc preprocessor = PP-LCNet orientation classify + unwarping (use_doc_orientation_classify).

**Relevance to PrintSense:** Quality ceiling for dense small rotated tag text on drawings — the family with documented rotated-text robustness (tech report: Rotate90 edit-distance 0.012). Too heavy for tonight on the dev box (paddle framework, py<=3.12); right home is the bot container as the upgraded cross-check engine.

### [PP-OCRv5 technical report (arXiv 2603.24373)](https://arxiv.org/abs/2603.24373) (verified)

**What:** Paper: 5M-parameter PP-OCRv5 achieves performance competitive with billion-parameter VLMs on OCR benchmarks, with better text localization and fewer hallucinations; data-centric (difficulty/accuracy/diversity) training.

**Relevance to PrintSense:** The published argument for exactly our Q2 pattern: a tiny deterministic pipeline rivals VLM reads and hallucinates less — ideal as the cross-check axis against Opus vision, not as a replacement.

### [PP-LCNet_x1_0_doc_ori (PaddleClas doc orientation)](https://huggingface.co/PaddlePaddle/PP-LCNet_x1_0_doc_ori) (verified)

**What:** 4-class (0/90/180/270) document-image orientation classifier; 99.06% top-1; 7MB; Apache-2.0; consumed via paddleocr DocImgOrientationClassification (requires paddlepaddle).

**Relevance to PrintSense:** The accuracy benchmark for 4-way upright and what PaddleOCR's pipeline uses internally; rapid-orientation is the same PULC lineage without the paddle framework — use PP-LCNet numbers as the expectation, rapid-orientation as the pip-only vehicle.

### [OnnxTR](https://github.com/felixdittrich92/OnnxTR) (verified)

**What:** docTR pipeline rewrapped on onnxruntime only (no torch/TF); Apache-2.0; `pip install onnxtr[cpu]`; detection DBNet/LinkNet/FAST, recognition CRNN/PARSeq/ViTSTR/etc.; supports detect_orientation, assume_straight_pages, straighten_pages; 8-bit quantized CPU models; PyPI v0.8.1 verified, Requires-Python >=3.10,<4 (CI tests 3.10–3.12, 3.14 untested).

**Relevance to PrintSense:** Second pip-only OCR family + orientation detection without torch — a credible A/B against RapidOCR for the cross-check pass; metadata does not block py3.14 but it is untested there.

### [docTR (mindee)](https://github.com/mindee/doctr) (verified)

**What:** Apache-2.0 document OCR; pip install python-doctr (PyTorch backend, py3.11+); explicit rotated-document support: assume_straight_pages=False, export_as_straight_boxes, orientation prediction.

**Relevance to PrintSense:** Solid general OCR with first-class rotation handling, but torch-based and tuned for documents more than sparse drawing callouts — OnnxTR gives the same models lighter; keep as reference implementation.

### [EasyOCR](https://github.com/JaidedAI/EasyOCR) (verified)

**What:** Apache-2.0 CRAFT+CRNN OCR; requires torch/torchvision; readtext(rotation_info=[90,180,270]) rotates each detected box and keeps the best-confidence read; allowlist/blocklist constrain the recognizer charset; detect()/recognize() split; last release v1.7.2 (Sep 2024); API docs at jaided.ai/easyocr/documentation verified.

**Relevance to PrintSense:** The only lib with a built-in 'try each 90-degree rotation per text box' knob plus a charset allowlist (A-Z0-9-/.) — uniquely suited to vertical tag labels for the cross-check. Costs a torch install, per-angle recognizer reruns (slow), and slow maintenance; second choice after RapidOCR.

### [Surya (datalab)](https://pypi.org/project/surya-ocr/) (verified)

**What:** 650M-param OCR + detection + layout + tables, 90+ languages; strong benchmarks (83.3% olmOCR-bench); torch + vLLM/llama.cpp; v0.21.1 (Jul 2026), py>=3.10. Code Apache-2.0 BUT model weights are modified AI Pubs Open Rail-M — free only under $5M funding/revenue, commercial license otherwise (GitHub fetch failed with socket hang up; facts verified via PyPI page).

**Relevance to PrintSense:** LICENSE-BLOCKED for MIRA (hard constraint: Apache 2.0 or MIT ONLY — Rail-M weights fail it) and GPU-heavy. Track only; do not adopt.

### [jdeskew](https://github.com/phamquiluan/jdeskew) (verified)

**What:** MIT; pip install jdeskew; skew estimation via Adaptive Radial Projection on the Fourier magnitude spectrum (ICIP 2022); handles fine skew up to ~45 degrees, avg error 0.07 degrees at 3072px; get_angle/rotate API.

**Relevance to PrintSense:** Fine-skew polish AFTER coarse 4-way upright (it cannot do 90/180/270). Straightens the slightly-tilted handheld bench photo so small tag glyphs sit on the baseline — helps both Opus and any OCR cross-check. Pure pip, tiny.

### [deskew (sbrunner)](https://github.com/sbrunner/deskew) (verified)

**What:** MIT; pip install deskew; Hough-style skew detection returning -45..45 degrees (angle_pm_90=True for -90..90); works with scikit-image or OpenCV.

**Relevance to PrintSense:** Alternative fine-skew estimator to jdeskew; same role, slightly older method. Pick one — jdeskew has the better published error numbers.

### [Tesseract tessdoc — Improving Quality (psm/DPI/binarization)](https://tesseract-ocr.github.io/tessdoc/ImproveQuality.html) (verified)

**What:** Official tuning guidance: >=300 DPI, 5.0 adds adaptive-Otsu and Sauvola binarization options, psm 11 = sparse text ('find as much text as possible in no particular order'), psm 12 = sparse + OSD, deskew and ~10px border recommendations.

**Relevance to PrintSense:** Container-side (binary exists there) tuning recipe if Tesseract stays in the stack: run psm 11/12 sparse passes at high DPI with Sauvola for line art. Community reports (tesseract-ocr group) note psm 11 struggles with 90-degree rotated text next to graphics — reinforcing that Tesseract is the weakest choice for drawing tags and OSD should not be the only upright.

### [tesserocr (why pip-only Tesseract on Windows fails)](https://pypi.org/project/tesserocr/) (verified)

**What:** MIT Python binding to the Tesseract C++ API; v2.10.0 (Feb 2026); wheels for Linux/macOS only — NO official Windows wheels; Windows users are directed to conda or third-party wheels (simonflueckiger/tesserocr-windows_build).

**Relevance to PrintSense:** Closes the question: there is no clean pip-only Tesseract on Windows (pytesseract also needs the external binary). Confirms the auto-upright fix should be onnxruntime-based, not 'install tesseract somehow'.

### [eDOCr (mechanical engineering drawing OCR)](https://github.com/javvi51/eDOCr) (verified)

**What:** MIT-licensed packaged OCR for mechanical engineering drawings built on keras-ocr/TensorFlow (>=2.0): segments dimensions, GD&T feature-control frames, and info/title blocks with custom-trained CRNN recognizers; ~90% det precision/recall, 8% CER in the companion paper; eDOCr2 successor repo exists.

**Relevance to PrintSense:** The closest domain-specific prior art for drawing OCR, but its TensorFlow dependency violates MIRA PRD §4 (no TF). Port the IDEAS — region segmentation before OCR, per-region charsets (dimension charset vs tag charset) — not the code.

### Adoptable tonight (hours, no heavy deps)

- Q1 step 0 — EXIF upright for free: add `img = ImageOps.exif_transpose(img)` at the top of the pipeline in printsense/preprocess.py prepare_print_image (Pillow 12.1.1 already installed; ~2 lines). Handles phone photos sent as Telegram *documents* (EXIF intact) and no-ops when the photo path already baked rotation. It is NOT sufficient alone: flat top-down bench shots have unreliable EXIF (accelerometer can't sense rotation about the vertical axis) and EXIF never sees content rotation — keep a content-based stage behind it.
- Q1 content-based upright without Tesseract: `py -3 -m pip install onnxruntime` (1.27.0 cp314 win_amd64 wheel verified) + rapid-orientation (Apache-2.0, PULC 0/90/180/270, 6.5MB ONNX, returns (label, score)). Its PyPI pin is <3.13 vs the box's 3.14.2, so either (a) `py -3 -m pip install --ignore-requires-python rapid-orientation` (pure-python package; its deps opencv/numpy are already present), or (b) vendor: pull rapid_orientation.onnx + the ~100-line inferencer out of the wheel into printsense/ with attribution. Wire it as a sibling of _auto_upright with the same contract: downscaled probe, confidence gate (like OSD_MIN_CONF), rotate full-res, defensive no-op on any failure. This makes auto-upright REAL on the dev box where Tesseract OSD currently no-ops.
- Q2 deterministic cross-check v0: `py -3.11 -m venv` (3.11.9 is on the launcher) or `--ignore-requires-python` on py3.14, then `pip install rapidocr onnxruntime` — RapidOCR bundles PP-OCRv6-small det+rec ONNX. One pass per sheet produces {token, box, confidence}; grader-side: exact/fuzzy-match every LLM device-tag read against the OCR token set — a tag Opus asserts that appears nowhere in OCR tokens gets flagged as a confident_misread candidate; duplicate_identifier gets corroborated by counting distinct OCR boxes bearing the same string (2 boxes = true sheet duplicate, 1 box = likely LLM double-read). Emit as advisory gate signal, never auto-fail — OCR misses on line art are real. If pyclipper lacks a cp314 wheel on py3.14, the 3.11 venv path is still pure pip.
- Optional polish: `pip install jdeskew` (MIT) and apply fine-skew correction (±45°, 0.07° avg err) after the 4-way upright so small tag text sits on the baseline for both Opus and the OCR cross-check.

### Adoptable later

- PaddleOCR 3.x full pipeline in the bot container (py<=3.12, paddlepaddle + paddleocr — too heavy for the Windows dev box): PP-OCRv5/v6 server det+rec plus PP-LCNet_x1_0_doc_ori (99.06% 4-way) and unwarping via use_doc_orientation_classify — the quality ceiling for dense small rotated tag text and the natural upgrade of the RapidOCR cross-check when it proves its value.
- OnnxTR (Apache-2.0, onnxruntime-only docTR: detect_orientation, straighten_pages, 8-bit CPU models, pip install onnxtr[cpu]) as an A/B second OCR family against RapidOCR on SCU2 sheet-20 crops; metadata allows py<4 but 3.14 is CI-untested.
- EasyOCR as the vertical-tag specialist second opinion: rotation_info=[90,180,270] retries each detected box per angle and allowlist constrains the charset to tag alphabet (A-Z0-9-/.) — unique capabilities, but torch install + per-angle recognizer reruns (slow) + slow maintenance (v1.7.2, Sep 2024) keep it out of tonight.
- Container-side Tesseract tuning where the binary exists: sparse-text passes with --psm 11/12 at >=300 DPI using 5.x Sauvola/adaptive-Otsu binarization; keep OSD as one voter but stop treating it as the only upright (psm 11 is known-weak on 90°-rotated text beside graphics). Do NOT plan on pip-only Tesseract for Windows — tesserocr ships no official win wheels and pytesseract needs the external binary.
- Port eDOCr/eDOCr2 concepts (MIT paper + repo): segment the drawing into title-block / dimension / callout regions first, then OCR each region with a region-specific charset — the biggest documented accuracy lever on engineering drawings; reimplement without keras-ocr/TensorFlow (blocked by PRD §4) on top of RapidOCR/OnnxTR primitives.
- Surya: license-blocked (model weights AI Pubs Open Rail-M with $5M revenue cap vs MIRA's Apache/MIT-only constraint) and GPU-heavy — track for benchmark comparisons only; revisit only if Datalab relicenses.
- If cross-check disagreement stays high on tag crops: fine-tune a PP-OCRv5 recognition head on harvested tag-crop data (PaddleOCR provides the training pipeline), then export to ONNX for the RapidOCR runtime.

## Delta-analysis vs PrintSense's existing defenses (0.55 conf-gate + Phase-3 blind batched 2-4x crop re-reads with deterministic match/differ). Verdict from the literature: the Phase-3 design IS factored Chain-of-Verification with the factor+revise cross-check done in code — already best-practice shape. What the best systems add is (1) VOTING ACROSS DECORRELATED VIEWS, not more samples of the same view — same-model/same-crop errors are correlated perception errors (mllms_know proves crop-choice, not sampling, drives small-detail failures), so the escalation ladder should change scale/view/engine, never resample; (2) AGREEMENT-RATE AS THE ONLY CALIBRATED CONFIDENCE — Anthropic's API exposes no logprobs anywhere (confirmed via current API docs), and verbalized confidence is known-uncalibrated (WK902 locally, SelfCheckGPT globally), so match-rate across blind reads is the machine_verified criterion and verbalized conf stays triage-only; (3) CONSTRAIN STRUCTURE, NEVER VALUES — Anthropic structured outputs/strict tools are GA but require additionalProperties:false (breaks load-bearing extra="allow"), and any enforced value-pattern (e.g. ^-W\d+$) would force pattern-completion of unreadable text — the exact WK902 failure mode; forced NON-strict tool call is the right JSON guarantee, with UNREADABLE always a legal value; (4) grammar validators act as VETO votes (discard candidates that fail DIN/IEC grammar), never as promoters; ties with no 2-agreement → abstain (UNREADABLE), never pick-the-confident-one; (5) OCR/second-model fusion as an independent VOTER, never as prompt anchor (olmOCR's anchoring was dropped; anchors propagate errors on scanned sources); (6) judge hygiene: position bias flips verdicts on order-swap and a Claude judge self-prefers Claude output, so the deterministic grader stays authoritative (PR4 already ordered grader-before-judge) and the judge must be blinded to extractor readings.

### [Chain-of-Verification (CoVe) — Dhuliawala et al., Meta AI](https://arxiv.org/abs/2309.11495) (verified)

**What:** Draft → plan verification questions → answer each verification question INDEPENDENTLY (factored variant: the draft is excluded from the verification context so the model cannot copy its own hallucination) → revise. Factored and factor+revise variants beat joint verification across Wikidata list QA, MultiSpanQA, and longform generation. Re-implementation: github.com/thuanystuart/DD3412-chain-of-verification-reproduction.

**Relevance to PrintSense:** Direct literature validation of Phase-3 verify.py: blind re-read without the candidate tag = factored CoVe; the deterministic match/differ logic = factor+revise's cross-check implemented in code (stronger than LLM self-check). The adoptable delta is enforcing the factored discipline as a hard rule: verify calls must carry NO package_context, NO candidate string, NO per-entity expected grammar class — any shared context is an anchor.

### [Self-Consistency (Wang et al., ICLR 2023)](https://arxiv.org/abs/2203.11171) (verified)

**What:** Sample N diverse reasoning paths (temperature sampling), majority-vote the final answer; +17.9% GSM8K, +11-12% SVAMP/AQuA. The canonical voting-N result.

**Relevance to PrintSense:** For extraction the vote is per-FIELD on normalized exact values, not per-document. Supplies the tie-break doctrine: >=2-of-N exact match after normalization (case/whitespace only — never digit-fuzzy, matching the grader's digit-drift rule) accepts; no majority → abstain. Note: Opus 4.8 removed temperature, so diversity must come from different VIEWS (crop scales) or rollouts, which is the better decorrelator anyway.

### [SelfCheckGPT](https://github.com/potsawee/selfcheckgpt) (verified)

**What:** MIT. Zero-resource black-box hallucination detection: sample N (typically 3) responses, measure per-sentence agreement via BERTScore/QA/n-gram/NLI/LLM-prompt ('Is the sentence supported by the context above? Answer Yes or No', averaged across samples). Low agreement = hallucination signal; outperforms greybox methods.

**Relevance to PrintSense:** THE substitute for the missing logprobs on the Anthropic path: agreement-rate across blind re-reads is the calibrated confidence PrintSense lacks. Store n_agree/n_reads per entity in evidence/disputed_reading and make agreement — never verbalized confidence — the machine_verified criterion.

### [V* / SEAL — Guided Visual Search (Wu & Xie)](https://github.com/penghao-wu/vstar) (verified)

**What:** MIT. Paper arxiv.org/abs/2312.14135. Meta-architecture: when the VQA LLM cannot confidently ground a target, an LLM-guided visual search module locates it, crops the region, and adds crop+coordinates to a Visual Working Memory before re-answering. Requires training custom LLaVA-based models (checkpoints provided) — not usable with API models directly.

**Relevance to PrintSense:** Donor for WHEN-TO-ESCALATE design: zoom/search is triggered by the model's own failure-to-ground, and crops always travel WITH their coordinates (their Entity.region bbox = same bookkeeping). The coverage-search pattern is the recall lever (device F1 0.80 → 0.85 needs missed-tag discovery, which verify-only passes cannot fix).

### [MLLMs Know Where to Look (ICLR 2025)](https://github.com/saccharomycetes/mllms_know) (verified)

**What:** MIT. Paper arxiv.org/abs/2502.17422. Training-free automatic cropping from the model's OWN attention/gradients (rel-att, grad-att, input-grad): MLLMs attend to the correct region even when they answer wrongly about small details; crop-then-re-ask significantly improves accuracy on 7 VQA benchmarks. Requires open-weight models (LLaVA-1.5/InstructBLIP internals).

**Relevance to PrintSense:** Proves small-detail failures are PERCEPTION (resolution/crop) errors, not sampling noise → re-reading the same view again is a correlated vote; re-reading at a different scale/view is not. This is the scientific basis for multi-scale verify votes tonight and for attention-based cropping later if a local open-weight VLM joins the loop.

### [ZoomEye — tree-based image exploration (EMNLP 2025 Oral)](https://github.com/om-ai-lab/ZoomEye) (verified)

**What:** Paper arxiv.org/abs/2411.16044. Training-free, model-agnostic tree search over the image pyramid: zoom in gradually, zoom OUT and backtrack to explore other branches when evidence isn't found; +15.71/+17.69 points on HR-Bench for InternVL2.5-8B, letting 3-8B models beat GPT-4o. Repo ships InternVL/Qwen2.5-VL integrations.

**Relevance to PrintSense:** Zoom level is a SEARCHED variable, not a fixed 2-4x: a crop can be too loose (neighboring text re-anchors pattern completion) or too tight (loses stroke context). Tonight: vote across two scales instead of one. Later: full iterative zoom-with-backtrack loop for entities still unresolved after batch verify.

### [olmOCR (Allen AI)](https://github.com/allenai/olmocr) (verified)

**What:** Apache-2.0 production PDF→text VLM pipeline. v1 'document anchoring' injected PDF text-layer text+coordinates into the VLM prompt to reduce hallucination (finishing sentences, captioning empty images); newer RL-trained models DROPPED anchoring (--target_anchor_text_len 'not used for new models'). Pipeline QA: --max_page_retries, --max_page_error_rate (1/250), blank-document hallucination rejection, tuned retry temperature.

**Relevance to PrintSense:** Two lessons: (a) anchoring is only safe when the anchor source is trustworthy (born-digital text layer) — for scanned prints, OCR output must be a cross-check VOTER, never a prompt anchor, or anchor errors + pattern-completion propagate; (b) copy the degenerate-output guards: reject blank/repetitive reads before they cost a verify call, and budget retries explicitly.

### [Anthropic structured outputs + strict tool use (GA)](https://platform.claude.com/docs/en/build-with-claude/structured-outputs.md) (verified)

**What:** output_config.format json_schema constrains the response; strict:true on tool definitions guarantees tool-input schema validity (max 20 strict tools). BOTH require additionalProperties:false on every object; numeric min/max constraints unsupported; incompatible with citations; 24h schema-compile cache. No logprobs parameter exists anywhere in the Messages API surface (cross-checked against the full current API reference).

**Relevance to PrintSense:** Confirms the Phase-2 call: forced NON-strict tool call (tool_choice={type:'tool'}) is the correct JSON guarantee for PrintSynthGraph's load-bearing extra='allow'; strict/json_schema would break it. Confirms 0-1 confidence bounds stay Pydantic validators. Critical decision rule: constrain STRUCTURE only — an enforced value pattern like ^-W\d+$ would force-complete unreadable text into a plausible tag (the exact WK902 failure); UNREADABLE must remain a legal value in every enum/pattern.

### [instructor (567-labs)](https://github.com/567-labs/instructor) (verified)

**What:** Structured LLM extraction on Pydantic: failed validation errors are fed back to the model as 'reask' messages with max_retries (models self-correct ~95% on first retry); InstructorRetryException carries all attempts; tenacity integration. Anthropic supported via from_provider('anthropic/...') with Mode.TOOLS, including images (Image.from_path/from_base64) and prompt caching (docs: python.useinstructor.com/integrations/anthropic/).

**Relevance to PrintSense:** The reask pattern is the industry-standard retry-on-validation loop: feed the EXACT validator/gate error back for one corrective attempt. Worth hand-rolling into interpret.py for machine-readable gate failures (e.g. the current duplicate_identifier FAIL) rather than adopting the dep — PrintSense already owns Pydantic validation and PRD §4 favors no abstraction over the LLM call.

### [DSPy BestOfN / Refine (replaced Assert/Suggest in 2.6)](https://dspy.ai/tutorials/output_refinement/best-of-n-and-refine/) (verified)

**What:** BestOfN: run a module up to N times with different rollout IDs, return first prediction whose deterministic reward_fn clears threshold (else best-scoring). Refine: same, plus LLM-generated feedback from the failed attempt is injected as hints into the next attempt. fail_count controls error tolerance.

**Relevance to PrintSense:** Maps 1:1 onto PrintSense's deterministic grader/gates as reward_fn: 're-run interpret until import_verdict passes or N=2' is a BestOfN loop over an existing deterministic signal. Copy the pattern (rollout-id variation + deterministic reward + feedback-on-retry), not the framework — DSPy itself is the kind of LLM-call abstraction the repo bans.

### [Large Language Models are not Fair Evaluators (Wang et al.)](https://arxiv.org/abs/2305.17926) (verified)

**What:** Demonstrates judge position bias: reordering candidates flips verdicts (Vicuna-13B 'beats' ChatGPT on 66/80 queries under ChatGPT-as-judge purely via ordering). Fix: Balanced Position Calibration — evaluate both orders and aggregate. Companion finding (Self-Preference Bias, arxiv.org/abs/2410.21819): judges favor their own model family's outputs.

**Relevance to PrintSense:** For the two-axis grade_case judge: (a) a Claude judge systematically under-catches Claude misreads (self-preference + it sees the same pixels and can make the same perceptual error) → judge is necessary-not-sufficient, deterministic grader stays authoritative (PR4's grader-before-judge order is correct — keep it); (b) any pairwise run comparison must swap orders; (c) blind the judge to extractor readings when asking legibility/existence questions.

### [Consensus-based structured extraction from pathology reports (medRxiv 2025)](https://www.medrxiv.org/content/10.1101/2025.04.22.25326217.full.pdf) (UNVERIFIED — treat as lead only)

**What:** Locally-deployed LLM ensemble for clinical structured extraction: multiple models/runs extract in parallel, merged by field-level consensus; cross-model agreement used as a reliability signal without ground truth. (Counterpoint from the same search: qualitax.io 'Consensus Is Not Correctness' — voting fails on correlated errors, which is why decorrelated voters matter.)

**Relevance to PrintSense:** Production-shaped evidence that extraction voting is done per-field with cross-MODEL decorrelation, supporting the later step of adding local qwen2.5vl (already in the MIRA stack via Open WebUI) as a second blind voter on verify crops — a same-model resample cannot provide this.

### Adoptable tonight (hours, no heavy deps)

- Two-scale verify votes (verify.py decision rule): re-read each risky entity at BOTH ~2x tight crop AND ~3-4x/context-margin crop as separate blind items in the same batched call. Decide on the 3-vote set {original read, read@A, read@B}: >=2 exact matches after normalization (case/whitespace only — NEVER digit-fuzzy) → machine_verified; anything else → UNREADABLE + rename everywhere referenced. Rationale: different views decorrelate perception errors (mllms_know/ZoomEye); a third sample of the same crop is a correlated vote worth almost nothing.
- Escalation ladder rewrite (when to escalate): on first differ, the N=3 escalation must change the VIEW (different scale or wider-context crop) — never resample the same crop; if no 2-agreement after 3 views → UNREADABLE/unresolved with a specific crop/retake request. Forbid 'pick the read with higher stated confidence' as a tie-break in all cases (verbalized conf is uncalibrated — WK902; no logprobs exist on the API).
- Grammar-as-veto, never as-promoter: DIN/IEC 81346 regexes (-W\d+$, \d+\.\d+, -X\d+(\.\d+)?, -\d+/[A-Z]\d+) act as vote FILTERS in verify decide(): a candidate failing grammar is discarded from the vote set; all candidates fail → UNREADABLE. Never allow a regex/schema to force a valid-shaped value and never put value-patterns into any decoder-enforced schema — constrained decoding of value patterns manufactures WK902-class confident misreads. UNREADABLE stays a legal value in every field.
- Factored-verification hard rule (verify prompt pattern): each verify item = crop + 'Transcribe exactly what is printed, one character at a time; if ANY character is uncertain output UNREADABLE' and nothing else. No candidate tag, no package_context, no per-entity expected grammar class, neutral shuffled item IDs (A/B/C). This is CoVe's factored variant — the anchor-free property is the entire mechanism; one leaked hint re-couples the errors.
- Consistency-as-confidence bookkeeping: record the vote outcome (n_agree/n_total + each differing string) into Entity.disputed_reading/evidence, and make agreement the SOLE machine_verified criterion. Verbalized confidence remains triage-only (selection band 0.55-0.85), extended with: it is never a tie-breaker and never a promotion signal (SelfCheckGPT doctrine, given no logprobs).
- Negative-control decoy per verify batch: include 1 crop from a known-blank margin/title-block-empty region; if the model returns any tag for the decoy, demote the ENTIRE batch's verify results to unresolved and log a yes-bias flag. Near-zero cost tripwire against sycophantic verify passes (judge-bias literature: models under pressure to produce answers produce them).
- Forced non-strict tool call for interpret.py JSON (Phase-2 item, ~20 lines, zero new deps): move from prose-JSON + _strip_fences to tools=[{name:'emit_print_graph', input_schema:<PrintSynthGraph schema WITHOUT additionalProperties:false>}] + tool_choice={type:'tool',name:'emit_print_graph'}; parse tool_use.input. Kills fence/prose/truncation parse failures while preserving extra='allow'. Do NOT use strict:true or output_config.format (both require additionalProperties:false).
- Reask micro-loop on deterministic gate failure: when a machine-readable gate fails (e.g. today's duplicate_identifier import_verdict FAIL), retry ONCE feeding back only the exact gate error + offending entity ids ('two entities share tag -21/A13; re-examine and correct or mark one UNREADABLE'); cap 1-2 retries, log each (instructor reask pattern + DSPy reward-threshold pattern, hand-rolled).
- Judge hygiene in grade_case/judge path: (a) grader-before-judge stays and judge can only worsen, never raise, the deterministic verdict; (b) when the judge assesses legibility/existence, blind it to the extractor's reading; (c) any pairwise comparison of two runs is evaluated in both orders and aggregated (Balanced Position Calibration). Assume a Claude judge under-catches Claude misreads (self-preference + shared perception).

### Adoptable later

- OCR cross-check fusion (decorrelated engine voter): run Tesseract word-level TSV with per-word confidences on the SAME verify crops; VLM+OCR agreement (normalized edit distance 0 on the tag token) → machine_verified, disagreement → escalate/UNREADABLE. Requires the tesseract binary on the runtime box (dev box lacks it; preprocess.py already degrades gracefully). Per olmOCR's lesson: OCR output is a voter, NEVER a prompt anchor for scanned prints.
- Second-model blind voter: qwen2.5vl (already in the MIRA stack via Open WebUI, INFERENCE_BACKEND=local) blind-reads the same crops; cross-model agreement is a far less correlated signal than same-model resamples (pathology-consensus pattern; 'Consensus Is Not Correctness' caveat about correlated ensembles). No new infra — it is the existing local fallback.
- ZoomEye-style iterative zoom for leftover unresolved entities: multi-turn loop that zooms stepwise, backtracks (zoom out, try sibling region) when a read stays uncertain, stops on 2-agreement or budget; adopt the tree/backtrack control flow, not the repo (its integrations are InternVL/Qwen-specific).
- V*/SEAL-style coverage pass for RECALL (the actual strict-A blocker: device F1 0.80 < 0.85): a second 'search for tags NOT in this list' pass over tiles, with the already-extracted tag list as an exclusion set (safe anchor: it anchors existence-search, not value-reading), keeping crop+bbox pairs as visual working memory. Verify passes alone cannot raise recall.
- Calibration measurement harness: over the frozen benchmark corpus, plot verbalized-confidence AND vote-agreement against grader-判 correctness (reliability curve / risk-coverage); re-derive the 0.55 gate and 0.55-0.85 verify band from data instead of intuition, operating point = 0 confident misreads at max coverage (selective-prediction framing).
- Attention/gradient-based cropping (mllms_know, MIT) for entities with no usable region bbox — requires an open-weight VLM with internals access, so only viable on the local qwen path; crops from the model's own attention outperform naive geometric crops on small-detail questions.
- olmOCR-style pipeline guards: blank/degenerate-crop detector before spending verify tokens (histogram/variance check in Pillow), per-sheet retry budget with explicit max_retries accounting and structured retry telemetry, repetition/degenerate-output rejection on interpret responses.
- Framework adoption only if hand-rolled loops sprawl: instructor (supports Anthropic + images + reask natively, MIT) or the DSPy BestOfN/Refine pattern — both conflict in spirit with PRD §4's no-abstraction-over-the-LLM-call rule, so prefer continuing to copy their decision rules into printsense-owned code.
