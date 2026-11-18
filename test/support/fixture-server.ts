import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

export type SiteName = 'good' | 'bad';

export interface RunningSite {
  url: string;
  close(): Promise<void>;
}

const SITES_DIR = fileURLToPath(new URL('../sites/', import.meta.url));

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

type Handler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

/**
 * Generated on the fly so the repository does not have to carry megabytes of
 * binary junk: the bad site's 6 MB "menu" PDF, its 4.8 MB hero photo and a
 * script that answers slowly.
 */
const BAD_ROUTES: Record<string, Handler> = {
  '/files/menu.pdf': (_req, res) => {
    const body = memo('pdf', () => fakePdf(6 * 1024 * 1024));
    res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': body.length });
    res.end(body);
  },
  '/img/hero.png': (_req, res) => {
    const body = memo('png', () => noisePng(1600, 1000));
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': body.length });
    res.end(body);
  },
  '/js/widgets.js': async (_req, res) => {
    await new Promise((r) => setTimeout(r, 800));
    res.writeHead(200, { 'content-type': 'text/javascript' });
    // Busy loop to make the main thread visibly blocked.
    res.end('(function(){var t=Date.now();while(Date.now()-t<450){}})();');
  },
};

const memoized = new Map<string, Buffer>();
function memo(key: string, make: () => Buffer): Buffer {
  let value = memoized.get(key);
  if (!value) {
    value = make();
    memoized.set(key, value);
  }
  return value;
}

/** Serves one of the fixture sites in test/sites on 127.0.0.1 at a random port. */
export async function startSite(name: SiteName, port = 0): Promise<RunningSite> {
  const root = resolve(SITES_DIR, name);
  const routes = name === 'bad' ? BAD_ROUTES : {};

  const server = createServer((req, res) => {
    void (async () => {
      const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
      const route = routes[path];
      if (route) {
        await route(req, res);
        return;
      }
      let file = normalize(join(root, path));
      if (!file.startsWith(root + sep) && file !== root) {
        res.writeHead(403).end();
        return;
      }
      if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
      if (!existsSync(file)) {
        res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><title>Not found</title><h1>404</h1>');
        return;
      }
      const headers: Record<string, string> = {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      };
      if (name === 'good') headers['cache-control'] = 'public, max-age=3600';
      res.writeHead(200, headers);
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      createReadStream(file).pipe(res);
    })().catch((err: unknown) => {
      res.writeHead(500).end(String(err));
    });
  });

  await new Promise<void>((ok) => server.listen(port, '127.0.0.1', ok));
  const { port: actual } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${actual}/`,
    close: () =>
      new Promise<void>((ok) => {
        server.closeAllConnections();
        server.close(() => {
          ok();
        });
      }),
  };
}

/** Deterministic pseudo-random bytes (mulberry32) so file sizes are stable. */
function noise(length: number, seed = 42): Buffer {
  const out = Buffer.allocUnsafe(length);
  let a = seed;
  for (let i = 0; i < length; i++) {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    out[i] = ((t ^ (t >>> 14)) >>> 0) & 0xff;
  }
  return out;
}

/** A valid RGB PNG full of noise, i.e. one that cannot be compressed. */
function noisePng(width: number, height: number): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  const pixels = noise(width * 3 * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0; // filter: none
    // Tint the noise towards terracotta so it reads as a "photo" in screenshots.
    for (let x = 0; x < width * 3; x += 3) {
      const p = y * width * 3 + x;
      raw[row + 1 + x] = 150 + ((pixels[p] ?? 0) % 100);
      raw[row + 2 + x] = 70 + ((pixels[p + 1] ?? 0) % 90);
      raw[row + 3 + x] = 40 + ((pixels[p + 2] ?? 0) % 70);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 1 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A one-page PDF padded with an incompressible stream to `bytes`. */
function fakePdf(bytes: number): Buffer {
  const head = Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\n4 0 obj<</Length ' +
      String(bytes) +
      '>>stream\n',
  );
  const tail = Buffer.from('\nendstream endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
  return Buffer.concat([head, noise(Math.max(0, bytes - head.length - tail.length), 7), tail]);
}
