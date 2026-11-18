import { describe, expect, it } from 'vitest';
import { analyzeSeo } from '../src/analyzers/seo.ts';
import type { AreaResult } from '../src/types.ts';
import { fixture, makeEvidence } from './support/evidence.ts';

const byId = (r: AreaResult, id: string) => {
  const c = r.checks.find((x) => x.id === id);
  if (!c) throw new Error(`no check ${id}`);
  return c;
};
const findingFor = (r: AreaResult, checkId: string) => r.findings.filter((f) => f.checkId === checkId);

describe('analyzeSeo on a healthy site', () => {
  const result = analyzeSeo(makeEvidence());

  it('passes every check', () => {
    const notPassing = result.checks.filter((c) => c.status !== 'pass').map((c) => c.id);
    expect(notPassing).toEqual([]);
    expect(result.findings).toEqual([]);
  });
});

describe('analyzeSeo on a neglected site', () => {
  const result = analyzeSeo(
    makeEvidence({
      html: fixture('bad-restaurant.html'),
      finalUrl: 'http://bad.test/',
      redirects: [
        { url: 'http://bad.test', status: 301 },
        { url: 'http://www.bad.test/', status: 302 },
        { url: 'http://bad.test/', status: 200 },
      ],
      httpUpgrade: { finalUrl: 'http://bad.test/', upgradesToHttps: false },
      tls: null,
      robots: { url: 'http://bad.test/robots.txt', status: 404, found: false },
      sitemap: { url: 'http://bad.test/sitemap.xml', status: 404, found: false },
      crawl: {
        pagesVisited: ['http://bad.test/'],
        linksChecked: 8,
        broken: [
          { url: 'http://bad.test/about', status: 404, foundOn: 'http://bad.test/' },
          { url: 'http://bad.test/contact', status: 404, foundOn: 'http://bad.test/' },
        ],
        heavyFiles: [],
        blockedByRobots: 0,
        truncated: false,
      },
    }),
  );

  it('fails HTTPS and explains it in plain English', () => {
    expect(byId(result, 'seo.https').status).toBe('fail');
    const [f] = findingFor(result, 'seo.https');
    expect(f?.title).toMatch(/not secure/i);
  });

  it('flags a generic title', () => {
    expect(byId(result, 'seo.title').status).toBe('warn');
    expect(findingFor(result, 'seo.title')[0]?.title).toContain('“Home”');
  });

  it('fails a missing description and missing Open Graph tags', () => {
    expect(byId(result, 'seo.description').score).toBe(0);
    expect(byId(result, 'seo.open-graph').score).toBe(0);
  });

  it('notices the page asks Google not to list it', () => {
    expect(byId(result, 'seo.indexable').status).toBe('fail');
    expect(findingFor(result, 'seo.indexable')[0]?.severity).toBe('critical');
  });

  it('reports broken structured data', () => {
    expect(byId(result, 'seo.structured-data').score).toBe(0);
    expect(findingFor(result, 'seo.structured-data')[0]?.title).toMatch(/broken/i);
  });

  it('penalises the long redirect chain', () => {
    expect(byId(result, 'seo.redirects').status).toBe('warn');
  });

  it('lists broken links with how many there are', () => {
    expect(byId(result, 'seo.broken-links').score).toBeCloseTo(0.5);
    expect(findingFor(result, 'seo.broken-links')[0]?.title).toMatch(/2 links/);
  });

  it('notes the missing robots.txt and sitemap', () => {
    expect(byId(result, 'seo.robots').status).toBe('warn');
    expect(byId(result, 'seo.sitemap').status).toBe('fail');
  });

  it('warns about two H1 headings', () => {
    expect(byId(result, 'seo.h1').status).toBe('warn');
  });
});

describe('analyzeSeo edge cases', () => {
  it('skips HTTPS checks on a local address', () => {
    const r = analyzeSeo(makeEvidence({ isLocal: true, finalUrl: 'http://127.0.0.1:4000/', tls: null, httpUpgrade: null }));
    expect(byId(r, 'seo.https').status).toBe('skip');
    expect(byId(r, 'seo.http-redirect').status).toBe('skip');
    expect(byId(r, 'seo.certificate').status).toBe('skip');
  });

  it('warns when the certificate expires within two weeks', () => {
    const r = analyzeSeo(makeEvidence({ tls: { valid: true, daysRemaining: 5 } }));
    expect(byId(r, 'seo.certificate').status).toBe('warn');
    expect(findingFor(r, 'seo.certificate')[0]?.title).toMatch(/5 days/);
  });

  it('fails an invalid certificate', () => {
    const r = analyzeSeo(makeEvidence({ tls: { valid: false, error: 'CERT_HAS_EXPIRED' } }));
    expect(byId(r, 'seo.certificate').status).toBe('fail');
  });

  it('fails a robots.txt that blocks every crawler', () => {
    const r = analyzeSeo(
      makeEvidence({ robots: { url: 'x', status: 200, found: true, body: 'User-agent: *\nDisallow: /' } }),
    );
    expect(byId(r, 'seo.robots').status).toBe('fail');
    expect(findingFor(r, 'seo.robots')[0]?.severity).toBe('critical');
  });

  it('honours an X-Robots-Tag noindex header', () => {
    const r = analyzeSeo(makeEvidence({ headers: { 'x-robots-tag': 'noindex, nofollow' } }));
    expect(byId(r, 'seo.indexable').status).toBe('fail');
  });

  it('gives partial credit for incomplete business data', () => {
    const html = `<html><head><title>Pão Quente bakery in Porto</title>
      <script type="application/ld+json">{"@type":"Bakery","name":"Pão Quente","address":"Rua A 1, Porto"}</script>
      </head><body><h1>Pão Quente</h1></body></html>`;
    const r = analyzeSeo(makeEvidence({ html }));
    const c = byId(r, 'seo.structured-data');
    expect(c.score).toBeGreaterThan(0.3);
    expect(c.score).toBeLessThan(0.9);
    expect(findingFor(r, 'seo.structured-data')[0]?.fix).toMatch(/telephone/);
  });

  it('skips the broken link check when no crawl ran', () => {
    expect(byId(analyzeSeo(makeEvidence({ crawl: null })), 'seo.broken-links').status).toBe('skip');
  });
});
