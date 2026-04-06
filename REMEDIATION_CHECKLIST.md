# Knowledge Base Remediation Checklist

Run these steps in order on Bravo. Each step depends on the previous.

## Pre-Flight

- [ ] 1. Pull latest code: `cd ~/Mira && git pull`
- [ ] 2. Run unit tests: `cd mira-crawler && python3 -m pytest tests/test_chunker.py -v`
        All 36 tests must pass.
- [ ] 3. Verify Docling installed: `python3 -c "from docling.document_converter import DocumentConverter; print('OK')"`
- [ ] 4. Verify Ollama running: `curl -s localhost:11434/api/tags | grep nomic-embed-text`

## Backup

- [ ] 5. Run backup:
        ```
        cd ~/Mira
        doppler run --project factorylm --config prd -- \
          bash mira-core/scripts/backup_knowledge_base.sh
        ```
- [ ] 6. Verify backup: check `backups/` directory, confirm MANIFEST.txt row counts match expected

## Remediate

- [ ] 7. Run remediation (DESTRUCTIVE — deletes all knowledge_entries, re-ingests):
        ```
        doppler run --project factorylm --config prd -- \
          bash mira-core/scripts/remediate_knowledge_base.sh
        ```
- [ ] 8. Review post-ingest output:
        - New total count
        - Chunk quality distribution — target < 5% `fallback_char_split`
        - Manufacturer distribution — all expected manufacturers present

## HNSW Migration

- [ ] 9. Run HNSW index migration:
        ```
        doppler run --project factorylm --config prd -- \
          psql $NEON_DATABASE_URL -f mira-core/scripts/migrate_to_hnsw.sql
        ```
- [ ] 10. Add `SET LOCAL hnsw.ef_search = 100` to `neon_recall.py` (one-line change)

## Smoke Test

- [ ] 11. Send test query via Telegram: "What does F4 mean on PowerFlex 40?"
         Verify: grounded response with source citation
- [ ] 12. Send test query: "What is the ambient temperature rating for the PowerFlex 525?"
         Verify: returns spec table data, not hallucinated values
