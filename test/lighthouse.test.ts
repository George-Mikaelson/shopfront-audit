import { describe, expect, it } from 'vitest';
import { summarizeLhr } from '../src/collector/lighthouse.ts';

const lhr = {
  lighthouseVersion: '13.6.0',
  categories: { performance: { score: 0.42 } },
  audits: {
    'first-contentful-paint': { numericValue: 2100.4 },
    'largest-contentful-paint': { numericValue: 7840.2 },
    'total-blocking-time': { numericValue: 640 },
    'cumulative-layout-shift': { numericValue: 0.31 },
    'speed-index': { numericValue: 5100 },
    'server-response-time': { numericValue: 120 },
    'total-byte-weight': { numericValue: 6_400_000 },
    'network-requests': {
      details: {
        items: [
          { url: 'http://x.test/', transferSize: 4_000, resourceType: 'Document' },
          { url: 'http://x.test/hero.png', transferSize: 5_000_000, resourceType: 'Image' },
          { url: 'http://x.test/a.js', transferSize: 90_000, resourceType: 'Script' },
          { url: 'data:image/png;base64,AAA', transferSize: 0, resourceType: 'Image' },
        ],
      },
    },
  },
};

describe('summarizeLhr', () => {
  it('keeps the score, the vitals and the biggest downloads', () => {
    const run = summarizeLhr(lhr, 'mobile');
    expect(run).toEqual({
      formFactor: 'mobile',
      score: 0.42,
      metrics: { fcp: 2100.4, lcp: 7840.2, tbt: 640, cls: 0.31, speedIndex: 5100, ttfb: 120 },
      totalBytes: 6_400_000,
      requestCount: 4,
      largestResources: [
        { url: 'http://x.test/hero.png', bytes: 5_000_000, resourceType: 'Image' },
        { url: 'http://x.test/a.js', bytes: 90_000, resourceType: 'Script' },
        { url: 'http://x.test/', bytes: 4_000, resourceType: 'Document' },
      ],
      lighthouseVersion: '13.6.0',
    });
  });

  it('turns missing audits into nulls instead of NaN', () => {
    const run = summarizeLhr({ lighthouseVersion: '13', categories: {}, audits: {} }, 'desktop');
    expect(run.score).toBeNull();
    expect(run.metrics.lcp).toBeNull();
    expect(run.totalBytes).toBeNull();
    expect(run.largestResources).toEqual([]);
  });
});
