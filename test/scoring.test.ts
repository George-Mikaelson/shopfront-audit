import { describe, expect, it } from 'vitest';
import { gradeFor, scoreChecks, scoreReport } from '../src/scoring/score.ts';
import type { AreaResult, Check, Finding } from '../src/types.ts';

const check = (id: string, weight: number, score: number, status?: Check['status']): Check => ({
  id,
  title: id,
  weight,
  score,
  status: status ?? (score >= 0.9 ? 'pass' : score >= 0.5 ? 'warn' : 'fail'),
  detail: '',
});

const finding = (checkId: string, area: Finding['area'], share = 1): Finding => ({
  id: `${checkId}-finding`,
  area,
  checkId,
  share,
  severity: 'high',
  effort: 'quick',
  title: checkId,
  explanation: '',
  fix: '',
});

describe('scoreChecks', () => {
  it('is the weighted mean of check scores on a 0-100 scale', () => {
    expect(scoreChecks([check('a', 3, 1), check('b', 1, 0)])).toBe(75);
  });

  it('ignores skipped checks', () => {
    expect(scoreChecks([check('a', 1, 1), check('b', 5, 0, 'skip')])).toBe(100);
  });

  it('returns null when nothing could be measured', () => {
    expect(scoreChecks([check('a', 1, 0, 'skip')])).toBeNull();
    expect(scoreChecks([])).toBeNull();
  });

  it('rounds to a whole number', () => {
    expect(scoreChecks([check('a', 1, 1), check('b', 1, 1), check('c', 1, 0)])).toBe(67);
  });
});

describe('gradeFor', () => {
  it.each([
    [95, 'A'],
    [90, 'A'],
    [80, 'B'],
    [65, 'C'],
    [45, 'D'],
    [10, 'F'],
    [null, '?'],
  ] as const)('%s -> %s', (score, grade) => {
    expect(gradeFor(score)).toBe(grade);
  });
});

describe('scoreReport', () => {
  const areas: AreaResult[] = [
    {
      area: 'performance',
      checks: [check('lcp', 1, 0)],
      findings: [finding('lcp', 'performance')],
    },
    {
      area: 'seo',
      checks: [check('title', 1, 1), check('desc', 1, 0)],
      findings: [finding('desc', 'seo')],
    },
    { area: 'nap', checks: [], findings: [], skippedReason: 'No business details given' },
  ];

  it('combines area scores with renormalised weights, leaving out unmeasured areas', () => {
    const report = scoreReport(areas, { performance: 3, seo: 1, nap: 5 });
    // performance 0 (weight 3/4), seo 50 (weight 1/4) -> 12.5 -> 13
    expect(report.overall).toBe(13);
    expect(report.areas.find((a) => a.area === 'nap')?.score).toBeNull();
  });

  it('estimates how many overall points each fix is worth and ranks by it', () => {
    const report = scoreReport(areas, { performance: 3, seo: 1, nap: 5 });
    expect(report.findings.map((f) => [f.checkId, f.gain])).toEqual([
      ['lcp', 75],
      ['desc', 12.5],
    ]);
  });

  it('splits a check’s lost points across findings by share', () => {
    const report = scoreReport(
      [
        {
          area: 'accessibility',
          checks: [check('serious', 1, 0)],
          findings: [
            finding('serious', 'accessibility', 0.75),
            { ...finding('serious', 'accessibility', 0.25), id: 'other' },
          ],
        },
      ],
      { accessibility: 1 },
    );
    expect(report.findings.map((f) => f.gain)).toEqual([75, 25]);
  });

  it('gives every area a human label', () => {
    const report = scoreReport(areas, { performance: 3, seo: 1, nap: 5 });
    expect(report.areas.map((a) => a.label)).toEqual(['Failing', 'Poor', 'Not checked']);
  });
});
