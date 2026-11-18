import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileCache } from '../src/lib/cache.ts';
import { createMutex, mapPool, retry, withTimeout } from '../src/lib/async.ts';
import { parseCsv } from '../src/lib/csv.ts';
import { isLocalHost, slugify } from '../src/lib/url.ts';
import { createLogger } from '../src/lib/log.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('mapPool', () => {
  it('never runs more than `concurrency` tasks at once and keeps input order', async () => {
    let running = 0;
    let peak = 0;
    const results = await mapPool([30, 10, 20, 5, 15], 2, async (ms) => {
      running++;
      peak = Math.max(peak, running);
      await sleep(ms);
      running--;
      return ms * 2;
    });
    expect(peak).toBe(2);
    expect(results.map((r) => (r.ok ? r.value : null))).toEqual([60, 20, 40, 10, 30]);
  });

  it('captures failures without stopping the other tasks', async () => {
    const results = await mapPool([1, 2, 3], 3, async (n) => {
      if (n === 2) throw new Error('boom');
      return n;
    });
    expect(results.map((r) => r.ok)).toEqual([true, false, true]);
    expect(results[1]?.ok === false && results[1].error.message).toBe('boom');
  });
});

describe('retry', () => {
  it('retries until the task succeeds', async () => {
    let attempts = 0;
    const value = await retry(
      async () => {
        attempts++;
        if (attempts < 3) throw new Error('flaky');
        return 'done';
      },
      { retries: 2, baseDelayMs: 1 },
    );
    expect(value).toBe('done');
    expect(attempts).toBe(3);
  });

  it('gives up after the last retry with the last error', async () => {
    let attempts = 0;
    await expect(
      retry(
        async () => {
          attempts++;
          throw new Error(`fail ${attempts}`);
        },
        { retries: 1, baseDelayMs: 1 },
      ),
    ).rejects.toThrow('fail 2');
  });

  it('does not retry errors the caller marks as permanent', async () => {
    let attempts = 0;
    await expect(
      retry(
        async () => {
          attempts++;
          throw new Error('404');
        },
        { retries: 3, baseDelayMs: 1, shouldRetry: () => false },
      ),
    ).rejects.toThrow('404');
    expect(attempts).toBe(1);
  });
});

describe('withTimeout', () => {
  it('rejects slow work and aborts its signal', async () => {
    let aborted = false;
    await expect(
      withTimeout(
        (signal) =>
          new Promise((resolve) => {
            signal.addEventListener('abort', () => {
              aborted = true;
            });
            setTimeout(resolve, 200);
          }),
        20,
        'audit',
      ),
    ).rejects.toThrow('audit timed out after 20 ms');
    expect(aborted).toBe(true);
  });

  it('passes through fast results', async () => {
    await expect(withTimeout(async () => 42, 100, 'x')).resolves.toBe(42);
  });
});

describe('createMutex', () => {
  it('runs critical sections one at a time', async () => {
    const lock = createMutex();
    const order: string[] = [];
    await Promise.all([
      lock(async () => {
        order.push('a:start');
        await sleep(20);
        order.push('a:end');
      }),
      lock(async () => {
        order.push('b:start');
        order.push('b:end');
      }),
    ]);
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });
});

describe('parseCsv', () => {
  it('parses quoted fields, escaped quotes, CRLF and a BOM into header-keyed rows', () => {
    const csv =
      String.fromCharCode(0xfeff) +
      'name,website,note\r\n"Café ""Sol""",https://sol.test,"a, b"\r\nPão,,\r\n';
    expect(parseCsv(csv)).toEqual([
      { name: 'Café "Sol"', website: 'https://sol.test', note: 'a, b' },
      { name: 'Pão', website: '', note: '' },
    ]);
  });

  it('keeps newlines inside quoted fields and skips blank lines', () => {
    expect(parseCsv('a,b\n"line1\nline2",x\n\n')).toEqual([{ a: 'line1\nline2', b: 'x' }]);
  });
});

describe('url helpers', () => {
  it.each([
    ['http://localhost:3000/', true],
    ['http://127.0.0.1/', true],
    ['http://[::1]:8080/', true],
    ['http://192.168.1.20/', true],
    ['http://shop.localhost/', true],
    ['https://example.com/', false],
    ['https://10.example.com/', false],
  ])('isLocalHost(%s) = %s', (url, expected) => {
    expect(isLocalHost(url)).toBe(expected);
  });

  it('slugifies names and hosts for folder names', () => {
    expect(slugify('Padaria & Confeitaria São João')).toBe('padaria-confeitaria-sao-joao');
    expect(slugify('https://www.Example.com/menu?x=1')).toBe('example-com-menu-x-1');
  });
});

describe('FileCache', () => {
  let dir = '';
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('returns stored values until they expire', async () => {
    dir = mkdtempSync(join(tmpdir(), 'sfa-cache-'));
    let now = 1_000;
    const cache = new FileCache<{ n: number }>(dir, { ttlMs: 100, now: () => now });
    await cache.set('https://a.test/', { n: 1 });
    expect(await cache.get('https://a.test/')).toEqual({ n: 1 });
    now += 101;
    expect(await cache.get('https://a.test/')).toBeUndefined();
  });

  it('misses cleanly on unknown keys', async () => {
    dir = mkdtempSync(join(tmpdir(), 'sfa-cache-'));
    const cache = new FileCache(dir, { ttlMs: 100 });
    expect(await cache.get('nope')).toBeUndefined();
  });
});

describe('createLogger', () => {
  it('writes one JSON object per line with level, message and fields', () => {
    const lines: string[] = [];
    const log = createLogger({
      format: 'json',
      level: 'info',
      write: (l) => lines.push(l),
      now: () => new Date(0),
    });
    log.debug('hidden');
    log.info('audit done', { url: 'https://a.test/', score: 80 });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '')).toEqual({
      ts: '1970-01-01T00:00:00.000Z',
      level: 'info',
      msg: 'audit done',
      url: 'https://a.test/',
      score: 80,
    });
  });

  it('adds bound fields with child()', () => {
    const lines: string[] = [];
    const log = createLogger({ format: 'json', level: 'debug', write: (l) => lines.push(l) }).child(
      { site: 'x' },
    );
    log.warn('slow');
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({ level: 'warn', site: 'x', msg: 'slow' });
  });
});
