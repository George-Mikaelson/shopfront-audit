import { parseArgs } from 'node:util';
import type { LogLevel } from './lib/log.ts';
import { FORMATS, type Format } from './reporters/write.ts';

export const HELP = `shopfront-audit: check a small business website and get a plain-English report

Usage
  shopfront-audit <url> [options]
  shopfront-audit --csv leads.csv --out reports/ [options]

Business details (compared with what the site shows)
  --name <text>            Business name, e.g. from OpenStreetMap
  --address <text>         Street address
  --phone <text>           Phone number
  --source <text>          Where those details come from (shown in the report)

Output
  --out <dir>              Output folder (default: ./shopfront-report, or ./reports for --csv)
  --format <list>          Comma-separated: html,json,md,pdf (default: html,json,pdf)
  --prepared-by <name>     Credit line in the report footer
  --prepared-by-url <url>  Link for the credit line
  --prepared-by-email <e>  Email for the credit line
  --fail-under <score>     Exit with code 2 when the overall score is lower (for CI)

What to run
  --no-lighthouse          Skip Lighthouse (much faster, no speed scores)
  --no-crawl               Skip checking internal links
  --max-pages <n>          Pages to crawl (default: 20)
  --timeout <seconds>      Page load / Lighthouse timeout (default: 45)

Batch mode (--csv)
  --csv <file>             CSV with url/website, name, address, phone columns
                           (OpenStreetMap tags like contact:website, addr:street also work)
  --concurrency <n>        Sites audited at once (default: 2)
  --retries <n>            Retries per site after a failure (default: 1)
  --site-timeout <seconds> Give up on a site after this long (default: 240)
  --cache-hours <h>        Reuse results younger than this (default: 24, 0 disables)

Logging
  --log-format <f>         pretty or json (default: pretty on a terminal, json otherwise)
  --log-level <l>          debug, info, warn, error, silent (default: info)
  -h, --help               Show this help
  -v, --version            Show the version
`;

export interface CliArgs {
  url?: string;
  csv?: string;
  out?: string;
  formats: Format[];
  business: { name?: string; address?: string; phone?: string; source?: string };
  preparedBy?: { name: string; url?: string; email?: string };
  failUnder?: number;
  lighthouse: boolean;
  crawl: boolean;
  maxPages: number;
  timeoutMs: number;
  concurrency: number;
  retries: number;
  siteTimeoutMs: number;
  cacheHours: number;
  logFormat?: 'json' | 'pretty';
  logLevel: LogLevel;
  help: boolean;
  version: boolean;
}

export class UsageError extends Error {
  override name = 'UsageError';
}

const positive = (name: string, raw: string | undefined, fallback: number, allowZero = false): number => {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || (!allowZero && n === 0)) {
    throw new UsageError(`--${name} must be a ${allowZero ? 'non-negative' : 'positive'} number, got “${raw}”`);
  }
  return n;
};

export function parseCliArgs(argv: string[]): CliArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    allowNegative: true,
    strict: true,
    options: {
      name: { type: 'string' },
      address: { type: 'string' },
      phone: { type: 'string' },
      source: { type: 'string' },
      out: { type: 'string', short: 'o' },
      format: { type: 'string', short: 'f' },
      'prepared-by': { type: 'string' },
      'prepared-by-url': { type: 'string' },
      'prepared-by-email': { type: 'string' },
      'fail-under': { type: 'string' },
      lighthouse: { type: 'boolean', default: true },
      crawl: { type: 'boolean', default: true },
      'max-pages': { type: 'string' },
      timeout: { type: 'string' },
      csv: { type: 'string' },
      concurrency: { type: 'string' },
      retries: { type: 'string' },
      'site-timeout': { type: 'string' },
      'cache-hours': { type: 'string' },
      'log-format': { type: 'string' },
      'log-level': { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
  });

  // "audit" is accepted as an optional sub-command: `shopfront-audit audit <url>`.
  const rest = positionals[0] === 'audit' ? positionals.slice(1) : positionals;
  if (rest.length > 1) throw new UsageError(`Expected one URL, got: ${rest.join(' ')}`);

  const formats = (values.format ?? 'html,json,pdf').split(',').map((f) => f.trim().toLowerCase());
  const bad = formats.filter((f) => !FORMATS.includes(f as Format));
  if (bad.length > 0) throw new UsageError(`Unknown format: ${bad.join(', ')} (use ${FORMATS.join(', ')})`);

  const logFormat = values['log-format'];
  if (logFormat !== undefined && logFormat !== 'json' && logFormat !== 'pretty') {
    throw new UsageError('--log-format must be json or pretty');
  }
  const logLevel = (values['log-level'] ?? 'info') as LogLevel;
  if (!['debug', 'info', 'warn', 'error', 'silent'].includes(logLevel)) {
    throw new UsageError('--log-level must be debug, info, warn, error or silent');
  }

  const args: CliArgs = {
    formats: formats as Format[],
    business: {},
    lighthouse: values.lighthouse,
    crawl: values.crawl,
    maxPages: positive('max-pages', values['max-pages'], 20),
    timeoutMs: positive('timeout', values.timeout, 45) * 1000,
    concurrency: positive('concurrency', values.concurrency, 2),
    retries: positive('retries', values.retries, 1, true),
    siteTimeoutMs: positive('site-timeout', values['site-timeout'], 240) * 1000,
    cacheHours: positive('cache-hours', values['cache-hours'], 24, true),
    logLevel,
    help: values.help,
    version: values.version,
  };
  if (rest[0]) args.url = rest[0];
  if (values.csv) args.csv = values.csv;
  if (values.out) args.out = values.out;
  if (logFormat) args.logFormat = logFormat;
  for (const k of ['name', 'address', 'phone', 'source'] as const) {
    const v = values[k]?.trim();
    if (v) args.business[k] = v;
  }
  if (values['prepared-by']) {
    args.preparedBy = { name: values['prepared-by'] };
    if (values['prepared-by-url']) args.preparedBy.url = values['prepared-by-url'];
    if (values['prepared-by-email']) args.preparedBy.email = values['prepared-by-email'];
  }
  if (values['fail-under'] !== undefined) args.failUnder = positive('fail-under', values['fail-under'], 0, true);

  if (!args.help && !args.version) {
    if (!args.url && !args.csv) throw new UsageError('Give a URL to audit, or --csv with a list of sites.');
    if (args.url && args.csv) throw new UsageError('Use either a URL or --csv, not both.');
  }
  return args;
}
