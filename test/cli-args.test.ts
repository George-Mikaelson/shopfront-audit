import { describe, expect, it } from 'vitest';
import { parseCliArgs } from '../src/cli-args.ts';

describe('parseCliArgs', () => {
  it('parses a single-site audit with business details', () => {
    const a = parseCliArgs([
      'audit',
      'bistro.test',
      '--name',
      'Bistro Verde',
      '--phone',
      '+351 1',
      '--format',
      'html,md',
      '--no-lighthouse',
    ]);
    expect(a).toMatchObject({
      url: 'bistro.test',
      business: { name: 'Bistro Verde', phone: '+351 1' },
      formats: ['html', 'md'],
      lighthouse: false,
      crawl: true,
      timeoutMs: 45_000,
    });
  });

  it('parses batch mode options', () => {
    const a = parseCliArgs([
      '--csv',
      'leads.csv',
      '--out',
      'reports',
      '--concurrency',
      '3',
      '--retries',
      '0',
      '--cache-hours',
      '0',
    ]);
    expect(a).toMatchObject({
      csv: 'leads.csv',
      out: 'reports',
      concurrency: 3,
      retries: 0,
      cacheHours: 0,
    });
  });

  it.each([
    [[], /Give a URL/],
    [['a.test', '--csv', 'x.csv'], /either a URL or --csv/],
    [['a.test', '--format', 'docx'], /Unknown format: docx/],
    [['a.test', '--concurrency', '0'], /--concurrency must be a positive number/],
    [['a.test', 'b.test'], /Expected one URL/],
    [['a.test', '--log-format', 'xml'], /--log-format/],
  ])('rejects %j', (argv, message) => {
    expect(() => parseCliArgs(argv)).toThrow(message);
  });

  it('lets --help through without a URL', () => {
    expect(parseCliArgs(['--help']).help).toBe(true);
  });
});
