#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { audit } from './audit.ts';
import { leadsFromCsv, runBatch } from './batch.ts';
import { HELP, parseCliArgs, UsageError, type CliArgs } from './cli-args.ts';
import { createLogger, type Logger } from './lib/log.ts';
import { AREA_NAMES } from './reporters/html.ts';
import { writeReport } from './reporters/write.ts';
import type { AuditReport } from './types.ts';
import { TOOL_VERSION } from './version.ts';

async function main(argv: string[]): Promise<number> {
  let args: CliArgs;
  try {
    args = parseCliArgs(argv);
  } catch (err) {
    if (
      err instanceof UsageError ||
      (err as { code?: string }).code?.startsWith('ERR_PARSE_ARGS')
    ) {
      process.stderr.write(`${(err as Error).message}\n\nRun shopfront-audit --help for usage.\n`);
      return 64;
    }
    throw err;
  }
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (args.version) {
    process.stdout.write(`${TOOL_VERSION}\n`);
    return 0;
  }

  const log = createLogger({
    level: args.logLevel,
    format: args.logFormat ?? (process.stderr.isTTY ? 'pretty' : 'json'),
  });
  const auditOptions = {
    lighthouse: args.lighthouse,
    crawl: args.crawl,
    maxPages: args.maxPages,
    timeoutMs: args.timeoutMs,
    logger: log,
  };
  const report = args.preparedBy ? { preparedBy: args.preparedBy } : {};

  if (args.csv) return batch(args, log, auditOptions, report);

  const out = resolve(args.out ?? 'shopfront-report');
  log.info('audit started', { url: args.url });
  const result = await audit(
    {
      url: args.url ?? '',
      ...(Object.keys(args.business).length > 0 ? { business: args.business } : {}),
    },
    auditOptions,
  );
  const files = await writeReport(result, out, { ...report, formats: args.formats });
  for (const w of result.warnings) log.warn(w);
  process.stdout.write(summary(result, files));
  if (args.failUnder !== undefined && (result.overall ?? 0) < args.failUnder) {
    log.error('score below threshold', { overall: result.overall, failUnder: args.failUnder });
    return 2;
  }
  return 0;
}

async function batch(
  args: CliArgs,
  log: Logger,
  auditOptions: Record<string, unknown>,
  report: object,
): Promise<number> {
  const csvPath = args.csv ?? '';
  const { leads, skipped } = leadsFromCsv(await readFile(csvPath, 'utf8'));
  for (const s of skipped) log.info('row skipped', { row: s.row, reason: s.reason });
  if (leads.length === 0) {
    log.error('no sites to audit', { csv: csvPath });
    return 1;
  }
  const outDir = resolve(args.out ?? 'reports');
  log.info('batch started', { sites: leads.length, concurrency: args.concurrency, outDir });
  const results = await runBatch(leads, {
    outDir,
    concurrency: args.concurrency,
    retries: args.retries,
    timeoutMs: args.siteTimeoutMs,
    cacheTtlMs: args.cacheHours * 3_600_000,
    formats: args.formats,
    audit: auditOptions,
    report,
    logger: log,
  });
  const failed = results.filter((r) => r.status === 'failed').length;
  process.stdout.write(
    `${results.length - failed} of ${results.length} sites audited. Summary: ${relative(process.cwd(), outDir) || '.'}/summary.csv\n`,
  );
  return failed === results.length ? 1 : 0;
}

function summary(r: AuditReport, files: string[]): string {
  const lines = [
    '',
    `  ${r.finalUrl}`,
    `  Grade ${r.grade}, ${r.overall ?? '–'}/100`,
    '',
    ...r.areas.map(
      (a) =>
        `  ${AREA_NAMES[a.area].padEnd(26)} ${a.score === null ? 'not checked' : String(a.score).padStart(3)}`,
    ),
    '',
  ];
  const top = r.findings.slice(0, 3);
  if (top.length > 0) {
    lines.push('  Fix first:');
    top.forEach((f, i) => lines.push(`  ${i + 1}. ${f.title}`));
    lines.push('');
  }
  lines.push(
    ...files
      .filter((f) => !f.includes('screenshots'))
      .map((f) => `  ${relative(process.cwd(), f)}`),
    '',
  );
  return `${lines.join('\n')}\n`;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    process.stderr.write(`shopfront-audit: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  },
);
