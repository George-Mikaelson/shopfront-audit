import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { audit } from '../../src/audit.ts';
import { writeReport } from '../../src/reporters/write.ts';
import type { AuditReport } from '../../src/types.ts';
import { BAD_BUSINESS, GOOD_BUSINESS } from '../support/businesses.ts';
import { startSite, type RunningSite } from '../support/fixture-server.ts';

const run = promisify(execFile);
const lighthouse = process.env.SHOPFRONT_E2E_LIGHTHOUSE !== '0';
const CLI = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));

let good: RunningSite;
let bad: RunningSite;
let goodReport: AuditReport;
let badReport: AuditReport;
let out: string;

beforeAll(async () => {
  [good, bad] = await Promise.all([startSite('good'), startSite('bad')]);
  out = mkdtempSync(join(tmpdir(), 'sfa-e2e-'));
  // Sequential on purpose: Lighthouse numbers get noisy when audits overlap.
  goodReport = await audit({ url: good.url, business: GOOD_BUSINESS }, { lighthouse });
  badReport = await audit({ url: bad.url, business: BAD_BUSINESS }, { lighthouse });
});

afterAll(async () => {
  await Promise.all([good.close(), bad.close()]);
  rmSync(out, { recursive: true, force: true });
});

const ids = (r: AuditReport) => r.findings.map((f) => f.checkId);

describe('the good site', () => {
  it('gets an A with every area above 85', () => {
    expect(goodReport.grade).toBe('A');
    for (const area of goodReport.areas) expect(area.score, area.area).toBeGreaterThanOrEqual(85);
  });

  it('has no serious findings', () => {
    expect(
      goodReport.findings.filter((f) => f.severity === 'critical' || f.severity === 'high'),
    ).toEqual([]);
  });

  it('was measured at three widths with screenshots', () => {
    expect(goodReport.screenshots.map((s) => s.width)).toEqual([375, 768, 1280]);
    expect(goodReport.warnings).toEqual([]);
  });
});

describe('the bad site', () => {
  it('fails overall', () => {
    expect(badReport.overall).toBeLessThan(40);
    expect(['D', 'F']).toContain(badReport.grade);
  });

  it('catches the heavy PDF menu with a waiting time', () => {
    expect(badReport.findings.map((f) => f.title)).toContain(
      'Your menu is a 6 MB PDF: on phones it takes about 10 s to open',
    );
  });

  it('catches the phone layout problems', () => {
    expect(ids(badReport)).toEqual(
      expect.arrayContaining(['mobile.viewport', 'mobile.overflow-phone', 'mobile.text-size']),
    );
    const phone = badReport.evidence.layouts.find((l) => l.width === 375);
    expect(phone?.layoutWidth).toBe(980);
    expect(phone?.scale).toBeLessThan(0.5);
  });

  it('catches search and listing problems', () => {
    expect(ids(badReport)).toEqual(
      expect.arrayContaining([
        'seo.title',
        'seo.description',
        'seo.structured-data',
        'seo.broken-links',
        'nap.phone',
        'nap.address',
      ]),
    );
    expect(badReport.evidence.crawl?.broken).toHaveLength(5);
  });

  it('finds accessibility violations with axe', () => {
    const rules = badReport.evidence.axe?.violations.map((v) => v.id) ?? [];
    expect(rules).toEqual(expect.arrayContaining(['image-alt', 'color-contrast', 'html-has-lang']));
  });

  it.runIf(lighthouse)('is slow on phones according to Lighthouse', () => {
    const m = badReport.evidence.lighthouse.mobile;
    expect(m?.score).toBeLessThan(0.7);
    expect(m?.metrics.lcp).toBeGreaterThan(4000);
    expect(goodReport.evidence.lighthouse.mobile?.score).toBeGreaterThanOrEqual(0.9);
  });
});

describe('report files', () => {
  it('writes HTML, JSON, Markdown and a real PDF', async () => {
    const dir = join(out, 'bad');
    const files = await writeReport(badReport, dir, { formats: ['html', 'json', 'md', 'pdf'] });
    expect(files.map((f) => f.slice(dir.length + 1).replace(/\\/g, '/')).sort()).toEqual([
      'report.html',
      'report.json',
      'report.md',
      'report.pdf',
      'screenshots/1280.jpg',
      'screenshots/375.jpg',
      'screenshots/768.jpg',
    ]);
    expect(readFileSync(join(dir, 'report.pdf')).subarray(0, 5).toString()).toBe('%PDF-');
    const json = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')) as AuditReport;
    expect(json.overall).toBe(badReport.overall);
    expect(readFileSync(join(dir, 'report.html'), 'utf8')).toContain('Trattoria Da Mario');
  });
});

describe('the CLI', () => {
  it('audits a CSV of sites and writes a summary', async () => {
    const csv = join(out, 'leads.csv');
    writeFileSync(
      csv,
      [
        'name,website,phone,addr:street,addr:housenumber,addr:postcode,addr:city',
        `Bistro Verde,${good.url},+351 21 234 5678,Rua das Flores,12,1200-195,Lisboa`,
        `Trattoria Da Mario,${bad.url},+39 06 1234 5678,Via Roma,45,00184,Roma`,
        'No Site Cafe,,,,,,',
      ].join('\n'),
    );
    const reports = join(out, 'reports');
    const { stdout, stderr } = await run(
      process.execPath,
      [
        CLI,
        '--csv',
        csv,
        '--out',
        reports,
        '--no-lighthouse',
        '--format',
        'html,json',
        '--log-format',
        'json',
        '--cache-hours',
        '0',
      ],
      { timeout: 200_000 },
    );
    expect(stdout).toContain('2 of 2 sites audited');
    const logs = stderr
      .split('\n')
      .filter((l) => l.startsWith('{'))
      .map((l) => JSON.parse(l) as { msg: string });
    expect(logs.filter((l) => l.msg === 'audit finished')).toHaveLength(2);
    expect(logs.some((l) => l.msg === 'row skipped')).toBe(true);
    const summary = readFileSync(join(reports, 'summary.csv'), 'utf8').trim().split('\n');
    expect(summary).toHaveLength(3);
    expect(summary[1]).toContain('Bistro Verde');
  });

  it('fails the build when the score is under --fail-under', async () => {
    const err = await run(
      process.execPath,
      [
        CLI,
        bad.url,
        '--out',
        join(out, 'ci'),
        '--no-lighthouse',
        '--format',
        'md',
        '--fail-under',
        '80',
        '--log-level',
        'silent',
      ],
      { timeout: 120_000 },
    ).catch((e: unknown) => e as { code: number; stdout: string });
    expect((err as { code: number }).code).toBe(2);
  });
});
