// ============================================================================
// diff.ts — Word/sentence-level side-by-side diff (UI helper)
// ============================================================================

import { diffWordsWithSpace } from "diff";

export interface DiffSegment {
  added: boolean;
  removed: boolean;
  value: string;
}

/** Compute a word-level diff array between before/after text. */
export function computeDiff(before: string, after: string): DiffSegment[] {
  const parts = diffWordsWithSpace(before, after);
  return parts.map((p) => ({
    added: !!p.added,
    removed: !!p.removed,
    value: p.value,
  }));
}

/** Quick similarity ratio in [0, 1] — used for telemetry badges. */
export function similarityRatio(before: string, after: string): number {
  if (!before && !after) return 1;
  if (!before || !after) return 0;
  const segs = computeDiff(before, after);
  let same = 0;
  let total = 0;
  for (const s of segs) {
    const len = s.value.trim().length;
    if (len === 0) continue;
    total += len;
    if (!s.added && !s.removed) same += len;
  }
  return total === 0 ? 1 : same / total;
}
