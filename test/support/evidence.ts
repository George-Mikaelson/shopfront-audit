import { readFileSync } from 'node:fs';
import type { Evidence, ViewportLayout } from '../../src/types.ts';

export const fixture = (name: string): string =>
  readFileSync(new URL(`../fixtures/html/${name}`, import.meta.url), 'utf8');

export function layout(width: number, overrides: Partial<ViewportLayout> = {}): ViewportLayout {
  return {
    width,
    layoutWidth: width,
    scrollWidth: width,
    scale: 1,
    overflowing: [],
    tapTargets: { total: 10, small: [] },
    text: { totalChars: 1000, smallChars: 0, samples: [] },
    ...overrides,
  };
}

/** A healthy, public HTTPS site. Override what a test is about. */
export function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  const html = overrides.html ?? fixture('good-restaurant.html');
  return {
    requestedUrl: 'https://example-bistro.test/',
    finalUrl: 'https://example-bistro.test/',
    redirects: [{ url: 'https://example-bistro.test/', status: 200 }],
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    isLocal: false,
    httpUpgrade: { finalUrl: 'https://example-bistro.test/', upgradesToHttps: true },
    tls: {
      valid: true,
      issuer: 'Test CA',
      validTo: '2027-06-01T00:00:00.000Z',
      daysRemaining: 195,
    },
    text: 'Bistro Verde\nRua das Flores 12, 1200-195 Lisboa\n+351 21 234 5678\nOpen daily 12:00-23:00',
    robots: {
      url: 'https://example-bistro.test/robots.txt',
      status: 200,
      found: true,
      body: 'User-agent: *\nAllow: /\n',
    },
    sitemap: {
      url: 'https://example-bistro.test/sitemap.xml',
      status: 200,
      found: true,
      urlCount: 4,
    },
    crawl: {
      pagesVisited: ['https://example-bistro.test/'],
      linksChecked: 12,
      broken: [],
      heavyFiles: [],
      blockedByRobots: 0,
      truncated: false,
    },
    lighthouse: { mobile: null, desktop: null },
    axe: { violations: [], passes: 40, incomplete: 0, axeVersion: '4.14.1' },
    layouts: [layout(375), layout(768), layout(1280)],
    screenshots: [],
    errors: [],
    ...overrides,
    html,
  };
}
