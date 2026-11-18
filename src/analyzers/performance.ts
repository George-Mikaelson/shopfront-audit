import type { AreaResult, Check, Evidence, HeavyFile, LighthouseRun } from '../types.ts';
import {
  downloadMs,
  FindingList,
  formatBytes,
  formatSeconds,
  lowerIsBetter,
  measure,
  plural,
  shortUrl,
  skipped,
} from './util.ts';

const MB = 1024 * 1024;
/** Images above this are almost always unoptimised photos straight from a camera. */
export const HEAVY_IMAGE_BYTES = 1 * MB;
/** PDFs and other downloads above this are painful on a phone. */
export const HEAVY_FILE_BYTES = 2 * MB;

/**
 * Speed, measured by Lighthouse with its default mobile profile (simulated slow
 * 4G, 4x CPU slowdown) and its desktop profile. Thresholds follow Google's
 * Core Web Vitals: https://web.dev/articles/vitals
 */
export function analyzePerformance(ev: Evidence): AreaResult {
  const findings = new FindingList('performance');
  const checks: Check[] = [];
  const { mobile, desktop, error } = ev.lighthouse;
  const why = error ? `Lighthouse could not run: ${error}` : 'Lighthouse was not run.';

  checks.push(scoreCheck('perf.mobile-score', 'Speed score on phones', 2, mobile, why));
  checks.push(scoreCheck('perf.desktop-score', 'Speed score on computers', 1, desktop, why));
  // The overall Lighthouse score gets no finding of its own: the vitals and
  // heavy-file findings below say what to change.
  const m = mobile?.metrics;
  if (!m || m.lcp === null) {
    checks.push(skipped('perf.lcp', 'Main content appears quickly', 3, why));
  } else {
    const lcp = measure(
      'perf.lcp',
      'Main content appears quickly',
      3,
      lowerIsBetter(m.lcp, 2500, 4000),
      `Largest Contentful Paint on a phone: ${formatSeconds(m.lcp)} (good is under 2.5 s).`,
    );
    checks.push(lcp);
    findings.add(lcp, {
      title: `On a phone, your page takes ${formatSeconds(m.lcp)} to show its main content`,
      explanation:
        'Until then visitors look at a half-empty screen. Most people give up on a page that takes more than a few seconds.',
      fix: 'Compress the large picture at the top of the page, and load fonts and scripts after the content.',
      severity: m.lcp > 4000 ? 'high' : 'medium',
      effort: 'moderate',
    });
  }

  if (!m || m.cls === null) {
    checks.push(skipped('perf.cls', 'Page does not jump around while loading', 2, why));
  } else {
    const cls = measure(
      'perf.cls',
      'Page does not jump around while loading',
      2,
      lowerIsBetter(m.cls, 0.1, 0.25),
      `Cumulative Layout Shift: ${m.cls.toFixed(2)} (good is under 0.1).`,
    );
    checks.push(cls);
    findings.add(cls, {
      title: 'Your page jumps around while it loads',
      explanation: 'Buttons move just as people try to tap them, so they hit the wrong thing.',
      fix: 'Give images and banners a fixed width and height so space is reserved before they load.',
      severity: 'medium',
      effort: 'moderate',
    });
  }

  if (!m || m.tbt === null) {
    checks.push(skipped('perf.tbt', 'Page responds quickly to taps', 2, why));
  } else {
    const tbt = measure(
      'perf.tbt',
      'Page responds quickly to taps',
      2,
      lowerIsBetter(m.tbt, 200, 600),
      `Total Blocking Time on a phone: ${Math.round(m.tbt)} ms (good is under 200 ms).`,
    );
    checks.push(tbt);
    findings.add(tbt, {
      title: 'Your page freezes for a moment when people tap it',
      explanation: `Scripts keep the phone busy for ${formatSeconds(m.tbt)}, so taps and scrolling feel stuck.`,
      fix: 'Remove unused plugins, widgets and tracking scripts, or load them after the page.',
      severity: m.tbt > 600 ? 'high' : 'medium',
      effort: 'moderate',
    });
  }

  if (mobile?.totalBytes == null) {
    checks.push(skipped('perf.page-weight', 'Light page', 2, why));
  } else {
    const bytes = mobile.totalBytes;
    const weight = measure(
      'perf.page-weight',
      'Light page',
      2,
      lowerIsBetter(bytes, 1.5 * MB, 5 * MB),
      `The home page downloads ${formatBytes(bytes)} in ${plural(mobile.requestCount ?? 0, 'request')}.`,
    );
    checks.push(weight);
    findings.add(weight, {
      title: `Your home page weighs ${formatBytes(bytes)}`,
      explanation: `On a typical phone connection that is about ${formatSeconds(downloadMs(bytes))} of downloading, and it eats into visitors’ data plans.`,
      fix: 'Aim for under 1.5 MB: resize photos to the size they are shown at and save them as WebP or AVIF.',
      severity: bytes > 5 * MB ? 'high' : 'medium',
      effort: 'moderate',
    });
  }

  const heavy = heavyFiles(ev, mobile);
  const heavyCheck = measure(
    'perf.heavy-files',
    'No oversized images or downloads',
    3,
    heavy.length === 0 ? 1 : heavy.length === 1 ? 0.4 : 0,
    heavy.length === 0
      ? 'No oversized images or files were found.'
      : `${plural(heavy.length, 'oversized file')} found, the largest is ${formatBytes(heavy[0]?.bytes ?? 0)}.`,
  );
  checks.push(heavyCheck);
  const total = heavy.reduce((s, f) => s + f.bytes, 0);
  for (const file of heavy) {
    findings.add(heavyCheck, describeHeavyFile(file, ev.finalUrl, total));
  }

  return { area: 'performance', checks, findings: findings.items };
}

function scoreCheck(id: string, title: string, weight: number, run: LighthouseRun | null, why: string): Check {
  if (!run || run.score === null) return skipped(id, title, weight, why);
  const pct = Math.round(run.score * 100);
  return measure(id, title, weight, run.score, `Lighthouse ${run.formFactor} performance score: ${pct}/100.`);
}

function heavyFiles(ev: Evidence, mobile: LighthouseRun | null): HeavyFile[] {
  const seen = new Map<string, HeavyFile>();
  for (const f of ev.crawl?.heavyFiles ?? []) {
    const isImage = f.contentType.startsWith('image/');
    if (f.bytes >= (isImage ? HEAVY_IMAGE_BYTES : HEAVY_FILE_BYTES)) seen.set(f.url, f);
  }
  for (const r of mobile?.largestResources ?? []) {
    if (r.resourceType === 'Image' && r.bytes >= HEAVY_IMAGE_BYTES && !seen.has(r.url)) {
      seen.set(r.url, { url: r.url, bytes: r.bytes, contentType: 'image/*', foundOn: ev.finalUrl });
    }
  }
  return [...seen.values()].sort((a, b) => b.bytes - a.bytes);
}

function describeHeavyFile(file: HeavyFile, base: string, total: number) {
  const size = formatBytes(file.bytes);
  const wait = formatSeconds(downloadMs(file.bytes));
  const name = fileName(file.url);
  const share = total > 0 ? file.bytes / total : 1;
  const isPdf = file.contentType.includes('pdf') || /\.pdf($|\?)/i.test(file.url);
  const isMenu = /menu|carta|cardapio|cardápio|speisekarte|carte/i.test(file.url);

  if (isPdf) {
    return {
      key: name,
      share,
      title: isMenu
        ? `Your menu is a ${size} PDF: on phones it takes about ${wait} to open`
        : `A ${size} PDF (${name}) takes about ${wait} to open on a phone`,
      explanation:
        'Many people give up before it opens, and a PDF is hard to read on a small screen: they have to pinch and zoom.',
      fix: isMenu
        ? 'Put the menu on a normal web page (it also helps Google), or at least compress the PDF to under 1 MB.'
        : 'Compress the PDF (most PDF tools have a “reduce file size” option) or turn it into a web page.',
      severity: 'high' as const,
      effort: 'quick' as const,
    };
  }
  return {
    key: name,
    share,
    title: `A ${size} image (${name}) slows down your page: about ${wait} on a phone`,
    explanation: 'Photos straight from a camera or phone are far bigger than a screen needs.',
    fix: `Resize ${shortUrl(file.url, base)} to at most 2000 px wide and save it as WebP or JPEG at 80% quality; it should end up under 300 KB.`,
    severity: file.bytes > 3 * MB ? ('high' as const) : ('medium' as const),
    effort: 'quick' as const,
  };
}

function fileName(url: string): string {
  try {
    const path = new URL(url).pathname;
    return decodeURIComponent(path.slice(path.lastIndexOf('/') + 1)) || path;
  } catch {
    return url;
  }
}
