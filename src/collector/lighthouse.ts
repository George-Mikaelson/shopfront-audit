import * as chromeLauncher from 'chrome-launcher';
import lighthouse, { desktopConfig } from 'lighthouse';
import type { LighthouseResource, LighthouseRun } from '../types.ts';

/** The subset of a Lighthouse result (LHR) we read. Kept loose on purpose. */
export interface LhrLike {
  lighthouseVersion: string;
  categories: Record<string, { score: number | null } | undefined>;
  audits: Record<string, { numericValue?: number; details?: { items?: unknown[] } } | undefined>;
  runtimeError?: { code: string; message: string };
}

const num = (lhr: LhrLike, id: string): number | null => {
  const v = lhr.audits[id]?.numericValue;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

/** Reduces a full LHR (several MB) to what the analyzers need. */
export function summarizeLhr(lhr: LhrLike, formFactor: 'mobile' | 'desktop'): LighthouseRun {
  const items = (lhr.audits['network-requests']?.details?.items ?? []) as {
    url?: string;
    transferSize?: number;
    resourceType?: string;
  }[];
  const largestResources: LighthouseResource[] = items
    .filter(
      (i) => typeof i.url === 'string' && !i.url.startsWith('data:') && (i.transferSize ?? 0) > 0,
    )
    .map((i) => ({
      url: i.url ?? '',
      bytes: i.transferSize ?? 0,
      resourceType: i.resourceType ?? 'Other',
    }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 10);

  return {
    formFactor,
    score: lhr.categories.performance?.score ?? null,
    metrics: {
      fcp: num(lhr, 'first-contentful-paint'),
      lcp: num(lhr, 'largest-contentful-paint'),
      tbt: num(lhr, 'total-blocking-time'),
      cls: num(lhr, 'cumulative-layout-shift'),
      speedIndex: num(lhr, 'speed-index'),
      ttfb: num(lhr, 'server-response-time'),
    },
    totalBytes: num(lhr, 'total-byte-weight'),
    requestCount: lhr.audits['network-requests'] ? items.length : null,
    largestResources,
    lighthouseVersion: lhr.lighthouseVersion,
  };
}

export interface LighthouseOptions {
  chromePath: string;
  formFactors?: ('mobile' | 'desktop')[];
  timeoutMs?: number;
}

/**
 * Runs Lighthouse (performance category only) in a Chrome started by
 * chrome-launcher, once per form factor. Lighthouse gets its own browser
 * process and a clean profile, which is what its throttling model assumes;
 * sharing the Playwright browser would mix in its contexts and timers.
 */
export async function runLighthouse(
  url: string,
  opts: LighthouseOptions,
): Promise<{ mobile: LighthouseRun | null; desktop: LighthouseRun | null }> {
  const chrome = await chromeLauncher.launch({
    chromePath: opts.chromePath,
    chromeFlags: [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--no-first-run',
      '--disable-dev-shm-usage',
    ],
    logLevel: 'silent',
  });
  const out: { mobile: LighthouseRun | null; desktop: LighthouseRun | null } = {
    mobile: null,
    desktop: null,
  };
  try {
    for (const formFactor of opts.formFactors ?? ['mobile', 'desktop']) {
      const flags = {
        port: chrome.port,
        output: 'json' as const,
        logLevel: 'error' as const,
        onlyCategories: ['performance'],
        maxWaitForLoad: opts.timeoutMs ?? 45_000,
      };
      const result = await lighthouse(
        url,
        flags,
        formFactor === 'desktop' ? desktopConfig : undefined,
      );
      const lhr = result?.lhr as unknown as LhrLike | undefined;
      if (!lhr) throw new Error('Lighthouse returned no result');
      if (lhr.runtimeError)
        throw new Error(`${lhr.runtimeError.code}: ${lhr.runtimeError.message}`);
      out[formFactor] = summarizeLhr(lhr, formFactor);
    }
  } finally {
    chrome.kill();
  }
  return out;
}
