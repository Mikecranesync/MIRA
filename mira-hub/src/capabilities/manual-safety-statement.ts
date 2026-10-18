/**
 * Extract manual safety statements from chunk text.
 *
 * Grounded in the manual's own markers (WARNING, DANGER, CAUTION, ATTENTION,
 * SHOCK HAZARD, BURN HAZARD) and narrow prose fallback patterns matched
 * against MANUAL TEXT ONLY (never the user's question).
 *
 * Reference: Task #4508, Stranger Walk safety-notice integration.
 */
import type { ManualSafetyStatementEntry } from '@/lib/notebook-chat-types';

export interface ManualSafetyStatement {
  marker: string;
  statement: string;
}

const SAFETY_MARKERS = [
  'WARNING',
  'DANGER',
  'CAUTION',
  'ATTENTION',
  'SHOCK HAZARD',
  'BURN HAZARD',
] as const;

/**
 * Check if a line starts with a safety marker (case-sensitive uppercase as printed).
 * The marker must be followed by a colon or whitespace to disambiguate from mid-word matches.
 */
function findMarkerAndStatement(text: string): ManualSafetyStatement | null {
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (const marker of SAFETY_MARKERS) {
      // The marker must open the line, after only whitespace and bullet/icon characters, and be
      // followed by ":", "!" (ABB) or whitespace — so "XWARNING" and a marker word inside ordinary
      // prose ("displays the WARNING: ACTIVE status") never count (#4509 Codex F2).
      const markerMatch = new RegExp(`^[\\s\\-•*▪●■◆►▶⚠!]*(${marker})[:!\\s]`).exec(line);
      if (markerMatch) {
        // Extract the statement following the marker
        const markerIndex = markerMatch.index + markerMatch[0].length - marker.length - 1;
        // Drop the marker's own punctuation ("ATTENTION:" → the sentence itself).
        const afterMarker = line.substring(markerIndex + marker.length).replace(/^[\s:!\-–—]+/, '').trim();

        // Collect sentences starting from the marker line
        const statementLines: string[] = [];

        // If marker line has content after the marker, include it
        if (afterMarker) {
          statementLines.push(afterMarker);
        }

        // Continue collecting lines until a sentence boundary or meaningful gap
        let sentenceCount = afterMarker ? 1 : 0;
        for (let j = i + 1; j < lines.length && statementLines.join(' ').length < 500; j++) {
          const nextLine = lines[j].trim();
          if (!nextLine) break; // Stop at blank lines
          statementLines.push(nextLine);
          // Count sentences (rough heuristic: ends with . ! or ?)
          if (/[.!?]$/.test(nextLine)) {
            sentenceCount++;
            if (sentenceCount >= 2) break; // Collect up to ~2 sentences
          }
        }

        let statement = statementLines.join(' ').trim();

        // Collapse whitespace and cap at ~400 chars on sentence boundary
        statement = statement.replace(/\s+/g, ' ');
        if (statement.length > 400) {
          // Find last sentence boundary within 400 chars
          const truncated = statement.substring(0, 400);
          const lastDot = Math.max(
            truncated.lastIndexOf('.'),
            truncated.lastIndexOf('!'),
            truncated.lastIndexOf('?'),
          );
          if (lastDot > 200) {
            // Reasonable sentence boundary found
            statement = statement.substring(0, lastDot + 1);
          } else {
            statement = truncated + '...';
          }
        }

        return { marker, statement };
      }
    }
  }

  // Prose fallback patterns (narrow, MANUAL TEXT ONLY)
  return matchProseFallback(text);
}

/**
 * Prose fallback for hazards stated without explicit markers.
 *
 * Patterns matched against MANUAL TEXT ONLY (never question text):
 * 1. "hazardous voltage(s) ... present" (with variations)
 * 2. Capacitor discharge context: "capacitors ... discharged ... voltage"
 * 3. Wait-after-power-off: "wait (at least) N minutes"
 */
function matchProseFallback(text: string): ManualSafetyStatement | null {
  // Pattern 1: Hazardous voltage(s) present
  const hazardVoltageMatch = text.match(
    /hazardous\s+voltages?\s+(?:are|remain)?\s*present/i,
  );
  if (hazardVoltageMatch) {
    // Find the sentence containing this match
    const idx = text.indexOf(hazardVoltageMatch[0]);
    // Look backwards for sentence start
    let sentenceStart = idx;
    for (let i = idx - 1; i >= 0; i--) {
      if (/[.!?]\s/.test(text.substring(i, i + 2))) {
        sentenceStart = i + 2;
        break;
      }
    }
    // Look forwards for sentence end
    let sentenceEnd = text.length;
    for (let i = idx; i < text.length; i++) {
      if (/[.!?]/.test(text[i])) {
        sentenceEnd = i + 1;
        break;
      }
    }
    const statement = text
      .substring(sentenceStart, sentenceEnd)
      .trim()
      .replace(/\s+/g, ' ')
      .substring(0, 400);
    if (statement.length > 3) {
      return {
        marker: 'WARNING (manual text)',
        statement,
      };
    }
  }

  // Pattern 2: Capacitor discharge
  const capacitorMatch = text.match(
    /capacitors?\s+(?:have\s+)?(?:been\s+)?discharged|discharged.*(?:voltage|V)/i,
  );
  if (capacitorMatch) {
    const sentences = text.split(/[.!?]/);
    for (const sentence of sentences) {
      if (sentence.toLowerCase().includes('capacitor') && sentence.toLowerCase().includes('discharged')) {
        const statement = (sentence.trim() + '.').replace(/\s+/g, ' ').substring(0, 400);
        return {
          marker: 'WARNING (manual text)',
          statement,
        };
      }
    }
  }

  // Pattern 3: Wait after power-off (flexible - can have power-off context OR in a maintenance/power-down section)
  const waitMatch = text.match(
    /wait\s+(?:at\s+least\s+)?(\d+)\s+(?:minutes?|min|mins?)/i,
  );
  if (waitMatch) {
    // Look for power-off context anywhere in the text (not just the immediate context)
    const hasContext =
      /(?:turn\s+off|power\s+off|shut\s+down|de\s*-?energize|discharge)/i.test(text);
    if (hasContext) {
      // Find the sentence containing the wait match
      const idx = text.indexOf(waitMatch[0]);
      let sentenceStart = idx;
      for (let i = idx - 1; i >= 0; i--) {
        if (/[.!?]\s/.test(text.substring(i, i + 2))) {
          sentenceStart = i + 2;
          break;
        }
      }
      let sentenceEnd = text.length;
      for (let i = idx; i < text.length; i++) {
        if (/[.!?]/.test(text[i])) {
          sentenceEnd = i + 1;
          break;
        }
      }
      const statement = text
        .substring(sentenceStart, sentenceEnd)
        .trim()
        .replace(/\s+/g, ' ')
        .substring(0, 400);
      if (statement.length > 3 && statement.toLowerCase().includes('wait')) {
        return {
          marker: 'WARNING (manual text)',
          statement,
        };
      }
    }
  }

  return null;
}

/**
 * Extract a manual safety statement from chunk text.
 *
 * Returns the marker (WARNING, CAUTION, etc.) and verbatim statement,
 * or null if no safety statement is found.
 */
export function extractManualSafetyStatement(text: string): ManualSafetyStatement | null {
  if (!text || typeof text !== 'string') {
    return null;
  }

  try {
    return findMarkerAndStatement(text);
  } catch {
    return null;
  }
}

/** The cited-source fields the helper reads (a subset of `EvidenceCitation`). */
type CitedSource = { citationId: string; docId: string; sourceTitle: string; page: number | null };
/** The retrieved-chunk fields the helper reads (a subset of `ManualChunk`). */
type PageChunk = { content: string; sourceUrl: string; sourcePage: number | null; docId?: string | null };

const pageKey = (c: { sourceUrl: string; sourcePage: number | null }) => `${c.sourceUrl}::${c.sourcePage ?? ''}`;

/** Retrieved chunks grouped by page, in `buildCitations` order: citationId n is group n. */
function pageGroups(chunks: readonly PageChunk[]): PageChunk[][] {
  const byKey = new Map<string, PageChunk[]>();
  for (const c of chunks) byKey.set(pageKey(c), [...(byKey.get(pageKey(c)) ?? []), c]);
  return [...byKey.values()];
}

/**
 * The notebook (v2) pages behind `citations`, for `retrieveCitedPageChunks` (#4509 Codex F1):
 * each cited page's document, file and page, taken from a chunk retrieval returned. Pages with
 * no document id (the OEM path) or no page number are skipped.
 */
export function citedPagesFor(
  citations: readonly CitedSource[],
  chunks: readonly PageChunk[],
): Array<{ docId: string; sourceUrl: string; page: number }> {
  const groups = pageGroups(chunks);
  const out: Array<{ docId: string; sourceUrl: string; page: number }> = [];
  for (const c of citations) {
    const first = groups[Number(c.citationId) - 1]?.[0];
    if (first?.docId && first.sourcePage != null) out.push({ docId: first.docId, sourceUrl: first.sourceUrl, page: first.sourcePage });
  }
  return out;
}

/**
 * The manual safety statement an answer's CITED pages carry, or null (#4508).
 *
 * Chunks are grouped exactly as the chat route's `buildCitations` numbers them
 * (and as `withSupportingQuotes` re-reads them): key
 * `${sourceUrl}::${sourcePage ?? ""}`, citationId n = the n-th distinct key.
 * Only the pages behind `citations` are read — the caller passes the EMITTED
 * citations, so a retrieved page the answer did not cite never counts. The
 * citations are walked in ascending citation number; the first hit wins.
 */
export function manualSafetyStatementForCitations(
  citations: readonly CitedSource[],
  chunks: readonly PageChunk[],
  pageChunks: readonly PageChunk[] = [],
): ManualSafetyStatementEntry | null {
  const groups = pageGroups(chunks);
  // The rest of each cited page (#4509 Codex F1) joins ONLY a page retrieval already returned, so
  // it can add text to a cited page but never a new page or a shifted citation number.
  const index = new Map(groups.map((g, i) => [pageKey(g[0]), i] as const));
  const pages = groups.map((g) => g.map((c) => c.content)); // citationId n ⇔ pages[n - 1]
  for (const c of pageChunks) {
    const i = index.get(pageKey(c));
    if (i !== undefined) pages[i].push(c.content);
  }
  const ordered = [...citations].sort((a, b) => Number(a.citationId) - Number(b.citationId));
  for (const c of ordered) {
    for (const content of pages[Number(c.citationId) - 1] ?? []) {
      const hit = extractManualSafetyStatement(content);
      if (hit) {
        return {
          kind: 'manual_safety_statement',
          marker: hit.marker,
          statement: hit.statement,
          sourceDocId: c.docId,
          sourceCitationId: c.citationId,
          sourceTitle: c.sourceTitle,
          page: c.page,
        };
      }
    }
  }
  return null;
}
