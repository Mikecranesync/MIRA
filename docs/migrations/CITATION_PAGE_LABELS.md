# Citation Page Label Migration

## Problem

MIRA citations show the PDF's internal page index, not the printed page number in the manual. A technician holding the paper manual turns to the wrong page.

**Example:** MIRA cites `p.13` when the printed page is `228` (or `2-15` in chapter-section manuals).

**Related Issues:**
- [#4794](https://github.com/Mikecranesync/MIRA/issues/4794) - printed vs PDF page
- [#4667](https://github.com/Mikecranesync/MIRA/issues/4667) - citation chip and source don't match
- [#5620](https://github.com/Mikecranesync/MIRA/issues/5620) - in-text page doesn't match chip
- [#5679](https://github.com/Mikecranesync/MIRA/issues/5679) - footnote cites wrong page

## Solution

### 1. Extract Page Labels at Ingest

New utility `mira-core/scripts/pdf_page_labels.py` extracts printed page labels from PDFs:

- **Primary:** PDF `/PageLabels` metadata (PDF Reference 1.7, Section 8.3.1)
- **Fallback:** Detect page numbers from headers/footers via PyMuPDF text extraction

Page labels stored in `knowledge_entries.metadata.page_label` (string field).

### 2. Update Citation Rendering

**Bot (mira-bots/shared/response_formatter.py):**
```python
# Prefer page_label (printed) over page_num (PDF index)
if page_label and isinstance(page_label, str):
    label = f"{label}, p. {page_label}"
elif isinstance(page_num, int) and page_num > 0:
    label = f"{label}, PDF p. {page_num}"  # Clear fallback
```

**Hub (mira-hub/src/lib/citation-page.ts):**
```typescript
// 1. Try metadata.page_label (printed page)
// 2. Fall back to sourcePage with "PDF p.N" prefix
```

### 3. Format Examples

| Scenario | Old Citation | New Citation |
|----------|--------------|--------------|
| PDF with page labels | `p.13` (wrong) | `p.228` (correct printed page) |
| Chapter-section manual | `p.47` (wrong) | `p.2-15` (chapter-section label) |
| Roman numeral front matter | `p.2` (PDF index) | `p.ii` (printed roman) |
| No labels available | `p.42` (ambiguous) | `PDF p.42` (clear it's PDF) |

### 4. Backward Compatibility

- **Existing chunks** without `page_label` fall back to `PDF p.N` format
- **New ingests** extract and store `page_label` automatically
- **No schema migration** required (uses existing `metadata` JSONB field)

## Migration Path

### For Already-Ingested Manuals

**Option A: Lazy Recompute (Recommended)**
- Let new uploads overwrite old chunks naturally
- Monitor `page_label` coverage via metadata query
- No prod writes, no downtime

**Option B: Backfill Script**
```bash
# NOT INCLUDED - requires explicit approval
# Would read PDFs from S3/disk, extract labels, UPDATE metadata
```

### For New Manuals

No action needed. The updated `ingest_manuals.py` extracts page labels automatically.

## Verification

### Unit Tests
- `tests/test_pdf_page_labels.py` - Page label extraction
- `tests/test_citation_page_integration.py` - End-to-end citation flow

### Manual Verification
1. Ingest a PDF with roman numeral front matter + offset pages
2. Ask a question that cites that PDF
3. Verify citation shows printed page label, not PDF index

### Test PDF Structure
```
Cover (unnumbered)
TOC: i, ii
Content: 1, 2, 3, ...

PDF page 0: (cover)
PDF page 1: printed "i"
PDF page 2: printed "ii"
PDF page 3: printed "1"
...
```

Expected citation for content on PDF page 3: `p.1` (not `p.3`)

## Rollout

1. **Merge** this PR (draft only, per instructions)
2. **Deploy** to staging
3. **Verify** with real manuals (AutomationDirect GS10, Rockwell PowerFlex 525)
4. **Monitor** citation accuracy in staging conversations
5. **Decision:** backfill existing manuals or wait for natural refresh
6. **Deploy** to production after staging gate passes

## Breaking Changes

None. Falls back gracefully for chunks without `page_label`.

## Future Work

- OCR-based page number detection improvements
- Backfill script for existing manuals (if approved)
- Telemetry: track `page_label` coverage vs fallback rate

## References

- PDF Reference 1.7: https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/PDF32000_2008.pdf
- PyMuPDF page labels: https://pymupdf.readthedocs.io/en/latest/document.html#Document.get_page_labels
