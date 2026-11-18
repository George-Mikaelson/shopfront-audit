import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Browser } from 'playwright';
import { audit, type AuditInput, type AuditOptions } from './audit.ts';
import { launchBrowser } from './collector/index.ts';
import { createMutex, mapPool, retry, withTimeout } from './lib/async.ts';
import { FileCache } from './lib/cache.ts';
import { csvCell, parseCsv } from './lib/csv.ts';
import { silentLogger, type Logger } from './lib/log.ts';
import { normalizeUrl, slugify } from './lib/url.ts';
import { escapeHtml as e } from './reporters/svg.ts';
import { writeReport, type Format, type WriteOptions } from './reporters/write.ts';
import type { AuditReport, BusinessInfo } from './types.ts';
import { TOOL_VERSION } from './version.ts';

export interface Lead {
  id: string;
  url: string;
  business: BusinessInfo;
}

const pick = (row: Record<string, string>, ...keys: string[]): string => {
  for (const k of keys) {
    const v = row[k]?.trim();
    if (v) return v;
  }
  return '';
};

/**
 * Leads from CSV. Understands plain headers (url/website, name, address,
 * phone) and OpenStreetMap tag names (contact:website, addr:street, …), so an
 * Overpass export can be fed in as is.
 */
export function leadsFromCsv(text: string): { leads: Lead[]; skipped: { row: number; reason: string }[] } {
  const leads: Lead[] = [];
  const skipped: { row: number; reason: string }[] = [];
  const seen = new Map<string, number>();

  parseCsv(text).forEach((row, i) => {
    const rowNo = i + 2; // 1-based, after the header
    const rawUrl = pick(row, 'url', 'website', 'contact:website', 'web', 'site');
    if (!rawUrl) {
      skipped.push({ row: rowNo, reason: 'no website' });
      return;
    }
    let url: string;
    try {
      if (/\s/.test(rawUrl)) throw new Error('space');
      url = normalizeUrl(rawUrl);
    } catch {
      skipped.push({ row: rowNo, reason: 'invalid URL' });
      return;
    }
    const key = url.replace(/\/+$/, '').replace(/^https?:\/\/(www\.)?/, '').toLowerCase();
    const first = seen.get(key);
    if (first !== undefined) {
      skipped.push({ row: rowNo, reason: `duplicate of row ${first}` });
      return;
    }
    seen.set(key, rowNo);

    const street = [pick(row, 'addr:street'), pick(row, 'addr:housenumber')].filter(Boolean).join(' ');
    const town = [pick(row, 'addr:postcode'), pick(row, 'addr:city')].filter(Boolean).join(' ');
    const address = pick(row, 'address', 'addr:full') || [street, town].filter(Boolean).join(', ');
    const business: BusinessInfo = {};
    const name = pick(row, 'name', 'business', 'title');
    const phone = pick(row, 'phone', 'contact:phone', 'telephone', 'tel');
    const source = pick(row, 'source', 'osm_url');
    if (name) business.name = name;
    if (phone) business.phone = phone;
    if (address) business.address = address;
    if (source) business.source = source;
    leads.push({ id: pick(row, 'id', 'lead_id') || slugify(name || url), url, business });
  });
  return { leads, skipped };
}

export type AuditFn = (input: AuditInput, signal: AbortSignal) => Promise<AuditReport>;

export interface BatchOptions {
  outDir: string;
  /** Sites audited at the same time. Lighthouse itself always runs one at a time. */
  concurrency?: number;
  retries?: number;
  retryDelayMs?: number;
  /** Hard limit for one site, all steps included. */
  timeoutMs?: number;
  /** Reuse results younger than this. 0 disables the cache. */
  cacheTtlMs?: number;
  formats?: readonly Format[];
  audit?: AuditOptions;
  report?: Omit<WriteOptions, 'formats' | 'browser'>;
  logger?: Logger;
  /** Replaces the real audit (tests, custom pipelines). */
  auditFn?: AuditFn;
}

export interface BatchResult {
  lead: Lead;
  status: 'ok' | 'cached' | 'failed';
  report?: AuditReport;
  dir?: string;
  error?: string;
  attempts: number;
}

/** Errors that will not fix themselves on a retry. */
const PERMANENT = /ENOTFOUND|EAI_AGAIN|ERR_NAME_NOT_RESOLVED|HTTP 4\d\d|Only http/;

export async function runBatch(leads: readonly Lead[], opts: BatchOptions): Promise<BatchResult[]> {
  const log = opts.logger ?? silentLogger;
  const formats = opts.formats ?? ['html', 'json', 'pdf'];
  const cache =
    (opts.cacheTtlMs ?? 0) > 0
      ? new FileCache<AuditReport>(join(opts.outDir, '.cache'), { ttlMs: opts.cacheTtlMs ?? 0 })
      : undefined;

  // One browser for every page probe and PDF; Lighthouse gets its own Chrome per run.
  let browser: Browser | undefined;
  const needsBrowser = !opts.auditFn || formats.includes('pdf');
  if (needsBrowser) browser = await launchBrowser();
  const lighthouseLock = createMutex();
  const auditFn: AuditFn =
    opts.auditFn ??
    ((input, signal) =>
      audit(input, { ...opts.audit, ...(browser ? { browser } : {}), lighthouseLock, logger: log, signal }));

  const used = new Set<string>();
  const folderFor = (lead: Lead): string => {
    const base = slugify(lead.id) || slugify(lead.url) || 'site';
    let name = base;
    for (let n = 2; used.has(name); n++) name = `${base}-${n}`;
    used.add(name);
    return name;
  };

  try {
    const settled = await mapPool(leads, opts.concurrency ?? 2, async (lead): Promise<BatchResult> => {
      const folder = folderFor(lead);
      const dir = join(opts.outDir, folder);
      const siteLog = log.child({ site: lead.url, id: lead.id });
      const cacheKey = JSON.stringify([TOOL_VERSION, lead.url, lead.business, opts.audit?.lighthouse ?? true]);
      const started = Date.now();
      let attempts = 0;
      let status: BatchResult['status'] = 'ok';
      try {
        let report = await cache?.get(cacheKey);
        if (report) {
          status = 'cached';
          siteLog.info('cache hit');
        } else {
          siteLog.info('audit started');
          report = await retry(
            async (attempt) => {
              attempts = attempt;
              return withTimeout((signal) => auditFn({ url: lead.url, business: lead.business }, signal), opts.timeoutMs ?? 180_000, `Audit of ${lead.url}`);
            },
            {
              retries: opts.retries ?? 1,
              baseDelayMs: opts.retryDelayMs ?? 2_000,
              shouldRetry: (err) => !PERMANENT.test(err.message),
              onRetry: (err, attempt, delayMs) => {
                siteLog.warn('audit failed, retrying', { attempt, delayMs, error: err.message });
              },
            },
          );
          await cache?.set(cacheKey, report);
        }
        await writeReport(report, dir, { ...opts.report, formats, ...(browser ? { browser } : {}) });
        siteLog.info('audit finished', { overall: report.overall, grade: report.grade, ms: Date.now() - started, status });
        return { lead, status, report, dir: folder, attempts };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        siteLog.error('audit failed', { error, attempts });
        return { lead, status: 'failed', error, attempts };
      }
    });
    const results = settled.map((s, i) =>
      s.ok ? s.value : { lead: leads[i] as Lead, status: 'failed' as const, error: s.error.message, attempts: 0 },
    );
    await writeSummary(opts.outDir, results);
    return results;
  } finally {
    await browser?.close();
  }
}

async function writeSummary(outDir: string, results: BatchResult[]): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const header = ['id', 'name', 'url', 'status', 'overall', 'grade', 'top_fix', 'report', 'error'];
  const rows = results.map((r) =>
    [
      r.lead.id,
      r.lead.business.name ?? '',
      r.lead.url,
      r.status,
      r.report?.overall ?? '',
      r.report?.grade ?? '',
      r.report?.findings[0]?.title ?? '',
      r.dir ? `${r.dir}/report.html` : '',
      r.error ?? '',
    ]
      .map(csvCell)
      .join(','),
  );
  await writeFile(join(outDir, 'summary.csv'), `${[header.join(','), ...rows].join('\n')}\n`);

  const sorted = [...results].sort((a, b) => (a.report?.overall ?? 101) - (b.report?.overall ?? 101));
  const items = sorted
    .map((r) => {
      const name = e(r.lead.business.name ?? r.lead.url);
      if (!r.report || !r.dir) return `<tr><td>${name}</td><td>–</td><td colspan="2">Failed: ${e(r.error ?? '')}</td></tr>`;
      return `<tr><td><a href="${e(r.dir)}/report.html">${name}</a></td><td class="n">${r.report.overall ?? '–'}</td><td>${e(r.report.grade)}</td><td>${e(r.report.findings[0]?.title ?? 'Nothing to fix')}</td></tr>`;
    })
    .join('\n');
  await writeFile(
    join(outDir, 'index.html'),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Website check-ups</title><style>body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:24px 16px;color:#1b2440;background:#f4f6f8}
main{max-width:1040px;margin:0 auto}table{width:100%;border-collapse:collapse;background:#fff}td,th{padding:8px 10px;border-bottom:1px solid #d8dde6;text-align:left;vertical-align:top}
.n{font-variant-numeric:tabular-nums;text-align:right}a{color:#2343a8}.wrap{overflow-x:auto}</style></head>
<body><main><h1>Website check-ups</h1><p>${results.length} sites, worst first.</p><div class="wrap"><table>
<thead><tr><th>Business</th><th class="n">Score</th><th>Grade</th><th>Biggest problem</th></tr></thead><tbody>
${items}
</tbody></table></div></main></body></html>
`,
  );
}
