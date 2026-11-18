import type {
  AreaId,
  AreaResult,
  Check,
  Grade,
  RankedFinding,
  ScoredArea,
  Severity,
} from '../types.ts';

/**
 * Default importance of each area in the overall score. For a small shop the
 * site mostly has to load fast on a phone and be findable, so those dominate.
 * Weights are renormalised over the areas that were actually measured.
 */
export const AREA_WEIGHTS: Readonly<Record<AreaId, number>> = {
  performance: 30,
  mobile: 25,
  seo: 20,
  accessibility: 15,
  nap: 10,
};

export type AreaWeights = Partial<Record<AreaId, number>>;

const measured = (checks: Check[]): Check[] => checks.filter((c) => c.status !== 'skip');

const weightOf = (checks: Check[]): number => checks.reduce((sum, c) => sum + c.weight, 0);

/** Weighted mean of check scores, 0..100, or null if nothing was measured. */
export function scoreChecks(checks: Check[]): number | null {
  const counted = measured(checks);
  const total = weightOf(counted);
  if (total === 0) return null;
  const earned = counted.reduce((sum, c) => sum + c.weight * clamp01(c.score), 0);
  return Math.round((100 * earned) / total);
}

export function gradeFor(score: number | null): Grade {
  if (score === null) return '?';
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

const LABELS: Record<Grade, string> = {
  A: 'Great',
  B: 'Good',
  C: 'Needs work',
  D: 'Poor',
  F: 'Failing',
  '?': 'Not checked',
};

export const labelFor = (score: number | null): string => LABELS[gradeFor(score)];

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const EFFORT_RANK = { quick: 0, moderate: 1, major: 2 } as const;

export interface ScoredReport {
  areas: ScoredArea[];
  overall: number | null;
  grade: Grade;
  findings: RankedFinding[];
}

/**
 * Turns analyzer output into scores and a ranked to-do list.
 *
 * overall = Σ areaScore·w / Σ w over measured areas.
 * A finding's gain is the number of overall points that would come back if
 * the check it belongs to scored 1 (split between findings by `share`):
 *   gain = 100 · (w_area / Σ w) · (w_check · (1 − s_check) / Σ w_checks) · share
 */
export function scoreReport(
  results: AreaResult[],
  weights: AreaWeights = AREA_WEIGHTS,
): ScoredReport {
  const areas: ScoredArea[] = results.map((r) => {
    const score = r.skippedReason ? null : scoreChecks(r.checks);
    return { ...r, score, label: labelFor(score) };
  });

  const scored = areas.filter((a): a is ScoredArea & { score: number } => a.score !== null);
  const totalWeight = scored.reduce((sum, a) => sum + (weights[a.area] ?? 0), 0);

  const overall =
    totalWeight === 0
      ? null
      : Math.round(scored.reduce((sum, a) => sum + a.score * (weights[a.area] ?? 0), 0) / totalWeight);

  const findings: RankedFinding[] = [];
  for (const area of scored) {
    const areaShare = (weights[area.area] ?? 0) / totalWeight;
    const counted = measured(area.checks);
    const checkWeight = weightOf(counted);
    for (const f of area.findings) {
      const c = counted.find((x) => x.id === f.checkId);
      const lost = c && checkWeight > 0 ? (c.weight * (1 - clamp01(c.score))) / checkWeight : 0;
      findings.push({ ...f, gain: round1(100 * areaShare * lost * f.share) });
    }
  }

  findings.sort(
    (a, b) =>
      b.gain - a.gain ||
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      EFFORT_RANK[a.effort] - EFFORT_RANK[b.effort],
  );

  return { areas, overall, grade: gradeFor(overall), findings };
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
