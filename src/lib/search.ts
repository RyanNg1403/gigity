/**
 * Shared search utilities for extracting and scoring message text.
 * Used by find, messages search, and oneshot commands.
 */

/** Extract human-readable text blocks from a JSONL record (skips tool inputs, file paths, JSON blobs). */
export function extractReadableText(record: { type: string; message?: { content?: unknown } }): string {
  const content = record.message?.content;
  if (!content) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    const b = block as Record<string, unknown>;
    if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
  }
  return parts.join(" ");
}

export interface ScoreResult {
  score: number;
  matchIdx: number;
}

/**
 * Score how well a text matches a search query.
 * - Exact phrase match: 1000 + phrase length
 * - Individual term matching: sum of matched term lengths (terms < 3 chars skipped)
 * - Requires at least 50% of meaningful terms to match, else score = 0
 */
export function scoreMatch(
  textLower: string,
  queryLower: string,
  queryTerms: string[],
): ScoreResult {
  let score = 0;
  let matchIdx = -1;

  // Exact phrase match gets massive boost
  const phraseIdx = textLower.indexOf(queryLower);
  if (phraseIdx >= 0) {
    score = 1000 + queryLower.length;
    matchIdx = phraseIdx;
  } else {
    // Individual term matching — longer terms score higher
    let matched = 0;
    for (const term of queryTerms) {
      if (term.length < 3) continue;
      const idx = textLower.indexOf(term);
      if (idx >= 0) {
        score += term.length;
        matched++;
        if (matchIdx < 0) matchIdx = idx;
      }
    }
    const meaningfulTerms = queryTerms.filter((t) => t.length >= 3).length;
    if (matched < Math.max(1, Math.ceil(meaningfulTerms * 0.5))) {
      score = 0;
    }
  }

  return { score, matchIdx };
}

/** Record types to skip during search (non-searchable content). */
export const SKIP_RECORD_TYPES = new Set([
  "file-history-snapshot",
  "last-prompt",
  "progress",
  "system",
]);
