import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crawlSite } from '../src/collector/crawl.ts';
import { fetchSiteFiles, followRedirects } from '../src/collector/http.ts';
import { parseRobots } from '../src/lib/robots.ts';
import { startSite, type RunningSite } from './support/fixture-server.ts';

let good: RunningSite;
let bad: RunningSite;
let redirector: Server;
let redirectBase = '';

beforeAll(async () => {
  [good, bad] = await Promise.all([startSite('good'), startSite('bad')]);
  redirector = createServer((req, res) => {
    const next: Record<string, [number, string]> = { '/a': [301, '/b'], '/b': [302, '/c'] };
    const hop = next[req.url ?? ''];
    if (hop) res.writeHead(hop[0], { location: hop[1] }).end();
    else res.writeHead(200, { 'content-type': 'text/html' }).end('<title>c</title>');
  });
  await new Promise<void>((ok) => redirector.listen(0, '127.0.0.1', ok));
  redirectBase = `http://127.0.0.1:${(redirector.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await Promise.all([good.close(), bad.close()]);
  await new Promise((ok) => redirector.close(ok));
});

describe('followRedirects', () => {
  it('records every hop and returns the final page', async () => {
    const r = await followRedirects(`${redirectBase}/a`);
    expect(r.hops.map((h) => [new URL(h.url).pathname, h.status])).toEqual([
      ['/a', 301],
      ['/b', 302],
      ['/c', 200],
    ]);
    expect(r.finalUrl).toBe(`${redirectBase}/c`);
    expect(r.body).toContain('<title>c</title>');
  });
});

describe('fetchSiteFiles', () => {
  it('finds robots.txt and counts sitemap URLs', async () => {
    const files = await fetchSiteFiles(good.url);
    expect(files.robots.found).toBe(true);
    expect(files.sitemap).toMatchObject({ found: true, urlCount: 3 });
  });

  it('reports missing files on the bad site', async () => {
    const files = await fetchSiteFiles(bad.url);
    expect(files.robots).toMatchObject({ found: false, status: 404 });
    expect(files.sitemap.found).toBe(false);
  });
});

describe('crawlSite', () => {
  it('finds no broken links on the good site', async () => {
    const r = await crawlSite(good.url, { maxPages: 10 });
    expect(r.broken).toEqual([]);
    expect(r.pagesVisited.length).toBe(3);
    expect(r.truncated).toBe(false);
  });

  it('finds broken internal links and where they are', async () => {
    const r = await crawlSite(bad.url, { maxPages: 10 });
    const broken = r.broken.map((b) => new URL(b.url).pathname).sort();
    expect(broken).toEqual(['/about.html', '/booking.html', '/gallery.html', '/privacy.html', '/staff.html']);
    expect(r.broken.find((b) => b.url.endsWith('/staff.html'))?.foundOn).toBe(`${bad.url}contact.html`);
  });

  it('measures heavy files without downloading them', async () => {
    const r = await crawlSite(bad.url, { maxPages: 10 });
    const heavy = Object.fromEntries(r.heavyFiles.map((f) => [new URL(f.url).pathname, f]));
    expect(heavy['/files/menu.pdf']?.bytes).toBe(6 * 1024 * 1024);
    expect(heavy['/files/menu.pdf']?.contentType).toBe('application/pdf');
    expect(heavy['/img/hero.png']?.bytes).toBeGreaterThan(4_000_000);
  });

  it('respects robots.txt', async () => {
    const robots = parseRobots(good.url, 'User-agent: *\nDisallow: /menu.html');
    const r = await crawlSite(good.url, { maxPages: 10, robots });
    expect(r.pagesVisited.some((p) => p.endsWith('/menu.html'))).toBe(false);
    expect(r.blockedByRobots).toBeGreaterThan(0);
  });

  it('stops at the page budget and says so', async () => {
    const r = await crawlSite(good.url, { maxPages: 1 });
    expect(r.pagesVisited).toHaveLength(1);
    expect(r.truncated).toBe(true);
  });
});
