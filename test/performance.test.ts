import { describe, expect, it } from 'vitest';
import { analyzePerformance } from '../src/analyzers/performance.ts';
import type { AreaResult, LighthouseRun } from '../src/types.ts';
import { makeEvidence } from './support/evidence.ts';

const run = (formFactor: 'mobile' | 'desktop', o: Partial<LighthouseRun> = {}): LighthouseRun => ({
  formFactor,
  score: 0.98,
  metrics: { fcp: 900, lcp: 1200, tbt: 30, cls: 0.01, speedIndex: 1100, ttfb: 80 },
  totalBytes: 400_000,
  requestCount: 12,
  largestResources: [],
  lighthouseVersion: '13.6.0',
  ...o,
});

const byId = (r: AreaResult, id: string) => r.checks.find((c) => c.id === id);

describe('analyzePerformance', () => {
  it('passes a fast site', () => {
    const r = analyzePerformance(
      makeEvidence({ lighthouse: { mobile: run('mobile'), desktop: run('desktop') } }),
    );
    expect(r.checks.every((c) => c.status === 'pass')).toBe(true);
    expect(r.findings).toEqual([]);
  });

  it('scores LCP linearly between the Core Web Vitals thresholds', () => {
    const mobile = run('mobile', { metrics: { ...run('mobile').metrics, lcp: 3250 } });
    const r = analyzePerformance(makeEvidence({ lighthouse: { mobile, desktop: null } }));
    expect(byId(r, 'perf.lcp')?.score).toBeCloseTo(0.5);
  });

  it('explains a slow phone load in seconds', () => {
    const mobile = run('mobile', {
      score: 0.31,
      metrics: { ...run('mobile').metrics, lcp: 7840, tbt: 900, cls: 0.4 },
    });
    const r = analyzePerformance(makeEvidence({ lighthouse: { mobile, desktop: null } }));
    const lcp = r.findings.find((f) => f.checkId === 'perf.lcp');
    expect(lcp?.title).toBe('On a phone, your page takes 7.8 s to show its main content');
    expect(byId(r, 'perf.cls')?.status).toBe('fail');
    expect(byId(r, 'perf.desktop-score')?.status).toBe('skip');
  });

  it('turns a heavy PDF menu into a concrete waiting time', () => {
    const r = analyzePerformance(
      makeEvidence({
        crawl: {
          pagesVisited: ['https://example-bistro.test/'],
          linksChecked: 5,
          broken: [],
          heavyFiles: [
            {
              url: 'https://example-bistro.test/files/menu.pdf',
              bytes: 6 * 1024 * 1024,
              contentType: 'application/pdf',
              foundOn: 'https://example-bistro.test/',
            },
          ],
          blockedByRobots: 0,
          truncated: false,
        },
      }),
    );
    const f = r.findings.find((x) => x.checkId === 'perf.heavy-files');
    expect(f?.title).toBe('Your menu is a 6 MB PDF: on phones it takes about 10 s to open');
    expect(byId(r, 'perf.heavy-files')?.status).toBe('fail');
  });

  it('merges oversized images reported by Lighthouse with crawled files', () => {
    const mobile = run('mobile', {
      largestResources: [
        { url: 'https://example-bistro.test/img/hero.png', bytes: 5_800_000, resourceType: 'Image' },
        { url: 'https://example-bistro.test/app.js', bytes: 90_000, resourceType: 'Script' },
      ],
    });
    const r = analyzePerformance(makeEvidence({ lighthouse: { mobile, desktop: null } }));
    const heavy = r.findings.filter((f) => f.checkId === 'perf.heavy-files');
    expect(heavy).toHaveLength(1);
    expect(heavy[0]?.title).toMatch(/5\.5 MB image \(hero\.png\)/);
  });

  it('skips Lighthouse checks with the reason when it could not run', () => {
    const r = analyzePerformance(
      makeEvidence({ lighthouse: { mobile: null, desktop: null, error: 'Chrome crashed' } }),
    );
    expect(byId(r, 'perf.mobile-score')?.status).toBe('skip');
    expect(byId(r, 'perf.mobile-score')?.detail).toContain('Chrome crashed');
    expect(byId(r, 'perf.heavy-files')?.status).toBe('pass');
  });
});
