import * as cheerio from 'cheerio';
import { mapPool } from '../lib/async.ts';
import type { Robots } from '../lib/robots.ts';
import type { CrawlResult, HeavyFile, LinkCheck } from '../types.ts';
import { USER_AGENT } from '../version.ts';
import { errorMessage, followRedirects, probe, type RequestOptions } from './http.ts';

export interface CrawlOptions extends RequestOptions {
  /** HTML pages to fetch and parse, including the start page. */
  maxPages?: number;
  /** Requests in flight at once. Keep it low: these are small shops' servers. */
  concurrency?: number;
  /** Total requests (pages + file probes), a safety net for huge sites. */
  maxRequests?: number;
  robots?: Robots;
}

/** Files at least this big are reported so analyzers can judge them. */
const REPORT_BYTES = 1024 * 1024;
const PAGE_EXT = /(\/|\.html?|\.php|\.aspx?|\.jsp|\/[^./]+)$/i;

/**
 * Breadth-first crawl of same-origin pages. Every internal link and image is
 * checked once (pages with GET, files with HEAD), so the result lists broken
 * links with the page they were found on, and oversized files.
 */
export async function crawlSite(startUrl: string, opts: CrawlOptions = {}): Promise<CrawlResult> {
  const maxPages = opts.maxPages ?? 20;
  const concurrency = opts.concurrency ?? 4;
  const maxRequests = opts.maxRequests ?? 200;
  const ua = opts.userAgent ?? USER_AGENT;
  const origin = new URL(startUrl).origin;

  const foundOn = new Map<string, string>(); // url -> first page linking to it
  const pages: string[] = [];
  const files = new Set<string>();
  const broken: LinkCheck[] = [];
  const heavyFiles: HeavyFile[] = [];
  let blockedByRobots = 0;
  let requests = 0;
  let truncated = false;

  const allowed = (url: string) => opts.robots?.isAllowed(url, ua) !== false;

  let frontier = [stripHash(startUrl)];
  foundOn.set(frontier[0] ?? startUrl, startUrl);

  while (frontier.length > 0) {
    const room = Math.min(maxPages - pages.length, maxRequests - requests);
    if (room <= 0) {
      truncated = true;
      break;
    }
    const batch = frontier.slice(0, room);
    if (batch.length < frontier.length) truncated = true;
    frontier = [];
    requests += batch.length;

    const results = await mapPool(batch, concurrency, async (url) => {
      const res = await followRedirects(url, { ...opts, maxHops: 5 });
      return { url, res };
    });

    for (const [i, r] of results.entries()) {
      const url = batch[i] ?? '';
      if (!r.ok) {
        broken.push({
          url,
          status: null,
          foundOn: foundOn.get(url) ?? startUrl,
          error: errorMessage(r.error),
        });
        continue;
      }
      const { res } = r.value;
      pages.push(url);
      if (res.status >= 400) {
        broken.push({ url, status: res.status, foundOn: foundOn.get(url) ?? startUrl });
        continue;
      }
      if (!(res.headers['content-type'] ?? '').includes('html')) continue;
      if (new URL(res.finalUrl).origin !== origin) continue;

      for (const { href, kind } of links(res.body, res.finalUrl)) {
        if (new URL(href).origin !== origin || foundOn.has(href)) continue;
        if (!allowed(href)) {
          blockedByRobots++;
          foundOn.set(href, url);
          continue;
        }
        foundOn.set(href, url);
        if (kind === 'page' && PAGE_EXT.test(new URL(href).pathname)) frontier.push(href);
        else files.add(href);
      }
    }
  }

  const fileList = [...files].slice(0, Math.max(0, maxRequests - requests));
  if (fileList.length < files.size) truncated = true;
  const probes = await mapPool(fileList, concurrency, (url) => probe(url, opts));
  probes.forEach((p, i) => {
    const url = fileList[i] ?? '';
    const where = foundOn.get(url) ?? startUrl;
    if (!p.ok) return;
    const { status, bytes, contentType, error } = p.value;
    if (status === null || status >= 400) {
      broken.push({ url, status, foundOn: where, ...(error ? { error } : {}) });
    } else if (bytes !== null && bytes >= REPORT_BYTES) {
      heavyFiles.push({ url, bytes, contentType, foundOn: where });
    }
  });

  return {
    pagesVisited: pages,
    linksChecked: foundOn.size - 1,
    broken,
    heavyFiles: heavyFiles.sort((a, b) => b.bytes - a.bytes),
    blockedByRobots,
    truncated,
  };
}

function links(html: string, base: string): { href: string; kind: 'page' | 'file' }[] {
  const $ = cheerio.load(html);
  const out: { href: string; kind: 'page' | 'file' }[] = [];
  const add = (raw: string | undefined, kind: 'page' | 'file') => {
    if (!raw || /^(mailto|tel|javascript|data|sms|whatsapp):/i.test(raw.trim())) return;
    try {
      const u = new URL(raw.trim(), base);
      if (u.protocol === 'http:' || u.protocol === 'https:')
        out.push({ href: stripHash(u.href), kind });
    } catch {
      /* not a URL */
    }
  };
  $('a[href]').each((_, el) => {
    add($(el).attr('href'), 'page');
  });
  $('img[src]').each((_, el) => {
    add($(el).attr('src'), 'file');
  });
  return out;
}

function stripHash(url: string): string {
  const u = new URL(url);
  u.hash = '';
  return u.href;
}
