import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildReport } from '../src/audit.ts';
import { leadsFromCsv, runBatch, type AuditFn } from '../src/batch.ts';
import { createLogger } from '../src/lib/log.ts';
import { makeEvidence } from './support/evidence.ts';

describe('leadsFromCsv', () => {
  it('reads plain columns and OpenStreetMap tag names', () => {
    const csv = [
      'name,website,phone,address,id',
      'Bistro Verde,bistro.test,+351 21 234 5678,"Rua das Flores 12, Lisboa",1',
      '',
    ].join('\n');
    const osm = [
      'name,contact:website,contact:phone,addr:street,addr:housenumber,addr:postcode,addr:city,osm_url',
      'Pão Quente,https://pao.test/,+351 22 000 1111,Rua Direita,5,4000-100,Porto,https://www.openstreetmap.org/node/1',
    ].join('\n');
    expect(leadsFromCsv(csv).leads).toEqual([
      {
        id: '1',
        url: 'https://bistro.test/',
        business: {
          name: 'Bistro Verde',
          phone: '+351 21 234 5678',
          address: 'Rua das Flores 12, Lisboa',
        },
      },
    ]);
    expect(leadsFromCsv(osm).leads[0]).toEqual({
      id: 'pao-quente',
      url: 'https://pao.test/',
      business: {
        name: 'Pão Quente',
        phone: '+351 22 000 1111',
        address: 'Rua Direita 5, 4000-100 Porto',
        source: 'https://www.openstreetmap.org/node/1',
      },
    });
  });

  it('skips rows without a usable website and duplicate sites', () => {
    const csv = 'name,website\nA,\nB,https://b.test\nC,https://b.test/\nD,not a url with spaces\n';
    const { leads, skipped } = leadsFromCsv(csv);
    expect(leads.map((l) => l.business.name)).toEqual(['B']);
    expect(skipped.map((s) => s.reason)).toEqual([
      'no website',
      'duplicate of row 3',
      'invalid URL',
    ]);
  });
});

describe('runBatch', () => {
  let dir = '';
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  const fakeReport = (url: string) =>
    buildReport(makeEvidence({ requestedUrl: url, finalUrl: url }));
  const quietLog = createLogger({ level: 'silent' });
  const leads = [
    { id: 'a', url: 'https://a.test/', business: { name: 'A' } },
    { id: 'b', url: 'https://b.test/', business: { name: 'B' } },
    { id: 'c', url: 'https://c.test/', business: { name: 'C' } },
  ];

  it('audits every lead with limited concurrency, retrying flaky failures', async () => {
    dir = mkdtempSync(join(tmpdir(), 'sfa-batch-'));
    let running = 0;
    let peak = 0;
    const attempts = new Map<string, number>();
    const auditFn: AuditFn = async ({ url }) => {
      running++;
      peak = Math.max(peak, running);
      attempts.set(url, (attempts.get(url) ?? 0) + 1);
      await new Promise((r) => setTimeout(r, 10));
      running--;
      if (url.includes('b.test') && attempts.get(url) === 1) throw new Error('ECONNRESET');
      return fakeReport(url);
    };
    const results = await runBatch(leads, {
      outDir: dir,
      concurrency: 2,
      retries: 1,
      retryDelayMs: 1,
      formats: ['json'],
      logger: quietLog,
      auditFn,
    });
    expect(peak).toBe(2);
    expect(results.map((r) => r.status)).toEqual(['ok', 'ok', 'ok']);
    expect(attempts.get('https://b.test/')).toBe(2);
    expect(existsSync(join(dir, 'a', 'report.json'))).toBe(true);
    const summary = readFileSync(join(dir, 'summary.csv'), 'utf8').trim().split('\n');
    expect(summary[0]).toBe('id,name,url,status,overall,grade,top_fix,report,error');
    expect(summary).toHaveLength(4);
    expect(existsSync(join(dir, 'index.html'))).toBe(true);
  });

  it('records sites that keep failing without stopping the batch', async () => {
    dir = mkdtempSync(join(tmpdir(), 'sfa-batch-'));
    const results = await runBatch(leads.slice(0, 2), {
      outDir: dir,
      retries: 0,
      formats: ['json'],
      logger: quietLog,
      auditFn: async ({ url }) => {
        if (url.includes('a.test')) throw new Error('getaddrinfo ENOTFOUND a.test');
        return fakeReport(url);
      },
    });
    expect(results[0]).toMatchObject({ status: 'failed', error: 'getaddrinfo ENOTFOUND a.test' });
    expect(results[1]?.status).toBe('ok');
  });

  it('serves repeated runs from the cache', async () => {
    dir = mkdtempSync(join(tmpdir(), 'sfa-batch-'));
    let calls = 0;
    const opts = {
      outDir: dir,
      formats: ['json'] as const,
      logger: quietLog,
      cacheTtlMs: 60_000,
      auditFn: async ({ url }: { url: string }) => {
        calls++;
        return fakeReport(url);
      },
    };
    await runBatch(leads.slice(0, 1), opts);
    const second = await runBatch(leads.slice(0, 1), opts);
    expect(calls).toBe(1);
    expect(second[0]?.status).toBe('cached');
  });

  it('gives up on an audit that exceeds the timeout', async () => {
    dir = mkdtempSync(join(tmpdir(), 'sfa-batch-'));
    const results = await runBatch(leads.slice(0, 1), {
      outDir: dir,
      retries: 0,
      timeoutMs: 20,
      formats: ['json'],
      logger: quietLog,
      auditFn: () => new Promise(() => undefined),
    });
    expect(results[0]?.status).toBe('failed');
    expect(results[0]?.error).toMatch(/timed out/);
  });
});
