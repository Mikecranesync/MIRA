# mira-ingest Exploration Notes
**Date:** 2026-03-30  
**Status:** Pre-build research complete  

## Key Technical Decisions Made

### Photo Observer
- iOS: `PHPhotoLibraryChangeObserver` (Apple native, fires on any camera roll addition)
  - Ref: https://developer.apple.com/documentation/photokit/phphotolibrarychangeobserver
  - RN bridge impl example: https://github.com/react-native-cameraroll/react-native-cameraroll/issues/341
- Android: `WorkManager` + `addTriggerContentUri(MediaStore.Images.Media.EXTERNAL_CONTENT_URI)`
  - Battery-safe, survives Doze mode
  - Ref: https://developer.android.com/topic/performance/background-optimization

### Gate Classifier
- `react-native-fast-tflite` (mrousavy, MIT) — JSI powered, GPU accelerated
  - https://github.com/mrousavy/react-native-fast-tflite
- MobileNetV3-Small base from TF Hub (Apache 2.0)
  - https://tfhub.dev/google/imagenet/mobilenet_v3_small_100_224/classification/5
- TFLite Model Maker for transfer learning
  - https://github.com/tensorflow/examples/tree/master/tensorflow_examples/lite/model_maker

### VLM Extraction
- `qwen2.5-vl:7b` confirmed as best local option for industrial label reading
  - Fits within 16GB RAM alongside Open WebUI
  - `ollama pull qwen2.5-vl:7b`

### Open WebUI KB API (confirmed working endpoints)
- Upload: `POST /api/v1/files/`
- Status poll: `GET /api/v1/files/{id}/process/status`
- Add to KB: `POST /api/v1/knowledge/{id}/file/add`
- Full docs: https://docs.openwebui.com/reference/api-endpoints/
- Reddit thread confirming async processing requirement: https://www.reddit.com/r/OpenWebUI/comments/1ka4gmp/

### Desktop Sync
- `rclone` (MIT) for Google Drive DCIM → local folder
  - https://rclone.org/googlephotos/
  - Config: `rclone sync gdrive:DCIM ~/mira-ingest-watch`
- `periodic-rclone-sync` Docker container (MIT, matthiasmullie)
  - https://github.com/matthiasmullie/periodic-rclone-sync
- Google Takeout cleanup: GTP (MIT, mshablovskyy)
  - https://github.com/mshablovskyy/GTP

### Manual Discovery
- `duckduckgo-search` (MIT) for filetype:pdf queries
  - https://github.com/deedy5/duckduckgo_search
- `beautifulsoup4` (MIT) for ManualsLib HTML parsing
- AutomationDirect + Rockwell direct URL patterns documented in PRD

## Open Questions for Exploration Phase
1. What is realistic VLM extraction accuracy on photos from Mike's 12k Takeout? Run 50 sample photos first.
2. Does qwen2.5-vl:7b fit in RAM alongside Open WebUI without swap? Profile on M4 before committing.
3. Can MobileNetV3 be fine-tuned with only ~100 labeled industrial positives from the Takeout? Try EdgeImpulse or TFLite Model Maker.
4. What is the iOS background constraint in practice? Test whether PHPhotoLibraryChangeObserver fires after 10 min backgrounded.
5. rclone Google Photos vs Google Drive DCIM — which path is more reliable after March 2025 API changes?

## Build Order (recommended to Claude Code)
1. Phase 1 server pipeline first — validates VLM quality before touching mobile
2. Stub gate classifier (return true for all jpgs) during Phase 1
3. Mobile observer second — real devices needed for testing
4. Gate classifier training last — needs real labeled data from Phase 1 results
