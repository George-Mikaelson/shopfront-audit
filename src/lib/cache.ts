import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

interface Entry<T> {
  key: string;
  storedAt: number;
  value: T;
}

/** A small JSON-on-disk cache with a time-to-live, one file per key. */
export class FileCache<T> {
  readonly dir: string;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(dir: string, opts: { ttlMs: number; now?: () => number }) {
    this.dir = dir;
    this.ttlMs = opts.ttlMs;
    this.now = opts.now ?? Date.now;
  }

  private file(key: string): string {
    return join(this.dir, `${createHash('sha256').update(key).digest('hex').slice(0, 32)}.json`);
  }

  async get(key: string): Promise<T | undefined> {
    try {
      const entry = JSON.parse(await readFile(this.file(key), 'utf8')) as Entry<T>;
      if (entry.key !== key || this.now() - entry.storedAt > this.ttlMs) return undefined;
      return entry.value;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: T): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const entry: Entry<T> = { key, storedAt: this.now(), value };
    await writeFile(this.file(key), JSON.stringify(entry));
  }
}
