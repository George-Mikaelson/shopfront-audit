import * as cheerio from 'cheerio';
import { chromium, type Browser } from 'playwright';
import { silentLogger, type Logger } from '../lib/log.ts';
import { parseRobots } from '../lib/robots.ts';
import { isLocalHost } from '../lib/url.ts';
import type { Evidence } from '../types.ts';
import { resolveChromePath } from './browser.ts';
import { crawlSite } from './crawl.ts';
import { errorMessage, fetchSiteFiles, followRedirects } from './http.ts';
import { runLighthouse } from './lighthouse.ts';
import { probePage } from './page.ts';
import { inspectTls } from './tls.ts';

export interface CollectOptions {
  /** Run Lighthouse (the slowest step, ~15 s per form factor). Default true. */
  lighthouse?: boolean;
  /** Crawl internal links. Default true. */
  crawl?: boolean;
  maxPages?: number;
  crawlConcurrency?: number;
  /** Per-step timeout for page loads and Lighthouse. */
  timeoutMs?: number;
  screenshots?: boolean;
  /** Reuse a browser across audits (batch mode). One is launched otherwise. */
  browser?: Browser;
  /** Serialises Lighthouse runs so parallel audits do not skew each other. */
  lighthouseLock?: <T>(fn: () => Promise<T>) => Promise<T>;
  logger?: Logger;
  signal?: AbortSignal;
}

/**
 * Gathers every fact the analyzers need about one site. Network failures in
 * individual steps are recorded in `errors` and leave that part empty; only
 * an unreachable home page throws.
 */
export async function collect(url: string, opts: CollectOptions = {}): Promise<Evidence> {
  const log = opts.logger ?? silentLogger;
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const req = { timeoutMs: Math.min(timeoutMs, 20_000), ...(opts.signal ? { signal: opts.signal } : {}) };
  const errors: string[] = [];

  log.debug('fetching home page', { url });
  const home = await followRedirects(url, req);
  if (home.status >= 400) throw new Error(`The home page answered HTTP ${home.status}`);
  const finalUrl = home.finalUrl;
  const isLocal = isLocalHost(finalUrl);
  const isHttps = finalUrl.startsWith('https:');

  const httpUrl = new URL(finalUrl);
  httpUrl.protocol = 'http:';
  const [httpUpgrade, tls, files] = await Promise.all([
    isLocal
      ? Promise.resolve(null)
      : followRedirects(httpUrl.href, req)
          .then((r) => ({ finalUrl: r.finalUrl, upgradesToHttps: r.finalUrl.startsWith('https:') }))
          .catch(() => null),
    isHttps && !isLocal ? inspectTls(finalUrl) : Promise.resolve(null),
    fetchSiteFiles(finalUrl, req),
  ]);

  log.debug('rendering page', { url: finalUrl });
  const ownBrowser = opts.browser ? undefined : await launchBrowser();
  const browser = opts.browser ?? ownBrowser;
  let page;
  try {
    page = await probePage(browser as Browser, finalUrl, {
      timeoutMs,
      ...(opts.screenshots === false ? { screenshots: false } : {}),
    });
  } finally {
    await ownBrowser?.close();
  }
  errors.push(...page.errors);
  if (!page.html) {
    // Rendering failed: fall back to the raw HTML so SEO/NAP checks still run.
    page.html = home.body;
    page.text = cheerio.load(home.body)('body').text().replace(/\s+\n/g, '\n');
  }

  let crawl = null;
  if (opts.crawl !== false) {
    log.debug('crawling', { url: finalUrl });
    try {
      crawl = await crawlSite(finalUrl, {
        ...req,
        maxPages: opts.maxPages ?? 20,
        concurrency: opts.crawlConcurrency ?? 4,
        ...(files.robots.found && files.robots.body
          ? { robots: parseRobots(finalUrl, files.robots.body) }
          : {}),
      });
    } catch (err) {
      errors.push(`Crawl failed: ${errorMessage(err)}`);
    }
  }

  const lighthouse: Evidence['lighthouse'] = { mobile: null, desktop: null };
  if (opts.lighthouse !== false) {
    const lock = opts.lighthouseLock ?? (<T>(fn: () => Promise<T>) => fn());
    try {
      const chromePath = await resolveChromePath();
      log.debug('running lighthouse', { url: finalUrl });
      Object.assign(lighthouse, await lock(() => runLighthouse(finalUrl, { chromePath, timeoutMs })));
    } catch (err) {
      lighthouse.error = errorMessage(err);
      errors.push(`Lighthouse failed: ${lighthouse.error}`);
    }
  }

  return {
    requestedUrl: url,
    finalUrl,
    redirects: home.hops,
    status: home.status,
    headers: home.headers,
    isLocal,
    httpUpgrade,
    tls,
    html: page.html,
    text: page.text,
    robots: files.robots,
    sitemap: files.sitemap,
    crawl,
    lighthouse,
    axe: page.axe,
    layouts: page.layouts,
    screenshots: page.screenshots,
    errors,
  };
}

/** Playwright's own Chromium, or $CHROME_PATH when set. */
export function launchBrowser(): Promise<Browser> {
  const executablePath = process.env.CHROME_PATH?.trim();
  return chromium.launch(executablePath ? { executablePath } : {});
}
