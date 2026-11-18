import type { FetchedFile, RedirectHop } from '../types.ts';
import { USER_AGENT } from '../version.ts';

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  userAgent?: string;
}

const DEFAULT_TIMEOUT = 15_000;

function signalFor(opts: RequestOptions): AbortSignal {
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT);
  return opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
}

async function request(
  url: string,
  opts: RequestOptions & { method?: string; headers?: Record<string, string> },
): Promise<Response> {
  return fetch(url, {
    method: opts.method ?? 'GET',
    redirect: 'manual',
    signal: signalFor(opts),
    headers: { 'user-agent': opts.userAgent ?? USER_AGENT, accept: '*/*', ...opts.headers },
  });
}

export interface FollowResult {
  hops: RedirectHop[];
  finalUrl: string;
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** GETs `url`, following up to `maxHops` redirects by hand so each hop is recorded. */
export async function followRedirects(
  url: string,
  opts: RequestOptions & { maxHops?: number } = {},
): Promise<FollowResult> {
  const hops: RedirectHop[] = [];
  let current = url;
  for (let i = 0; i <= (opts.maxHops ?? 10); i++) {
    const res = await request(current, opts);
    hops.push({ url: current, status: res.status });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      current = new URL(location, current).href;
      continue;
    }
    return {
      hops,
      finalUrl: current,
      status: res.status,
      headers: Object.fromEntries(res.headers),
      body: await res.text(),
    };
  }
  throw new Error(`Too many redirects starting at ${url}`);
}

export interface SizeProbe {
  status: number | null;
  bytes: number | null;
  contentType: string;
  error?: string;
}

/**
 * Status, size and type of a URL without downloading it: HEAD first, then a
 * one-byte ranged GET for servers that reject HEAD or omit Content-Length.
 */
export async function probe(url: string, opts: RequestOptions = {}): Promise<SizeProbe> {
  try {
    let res = await headFollowing(url, opts);
    let bytes = Number(res.headers.get('content-length') ?? NaN);
    if (res.status === 405 || res.status === 501 || (res.ok && !Number.isFinite(bytes))) {
      res = await request(res.url || url, { ...opts, headers: { range: 'bytes=0-0' } });
      const range = /\/(\d+)$/.exec(res.headers.get('content-range') ?? '');
      bytes = range ? Number(range[1]) : Number(res.headers.get('content-length') ?? NaN);
      await res.body?.cancel();
    }
    return {
      status: res.status === 206 ? 200 : res.status,
      bytes: Number.isFinite(bytes) ? bytes : null,
      contentType: (res.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '',
    };
  } catch (err) {
    return { status: null, bytes: null, contentType: '', error: errorMessage(err) };
  }
}

async function headFollowing(url: string, opts: RequestOptions): Promise<Response> {
  let current = url;
  for (let i = 0; i < 5; i++) {
    const res = await request(current, { ...opts, method: 'HEAD' });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current).href;
      continue;
    }
    return res;
  }
  throw new Error('Too many redirects');
}

/** robots.txt and sitemap.xml (from the robots Sitemap line, else /sitemap.xml). */
export async function fetchSiteFiles(
  siteUrl: string,
  opts: RequestOptions = {},
): Promise<{ robots: FetchedFile; sitemap: FetchedFile & { urlCount?: number } }> {
  const robots = await fetchFile(new URL('/robots.txt', siteUrl).href, opts);
  if (robots.found && !/user-agent|disallow|allow|sitemap/i.test(robots.body ?? '')) {
    // Soft 404: an HTML page served for every path.
    robots.found = false;
  }
  const declared = robots.found ? /^\s*sitemap:\s*(\S+)/im.exec(robots.body ?? '')?.[1] : undefined;
  const sitemapUrl = new URL(declared ?? '/sitemap.xml', siteUrl).href;
  const sitemap: FetchedFile & { urlCount?: number } = await fetchFile(sitemapUrl, opts);
  if (sitemap.found) {
    const body = sitemap.body ?? '';
    if (/<(urlset|sitemapindex)\b/i.test(body)) {
      sitemap.urlCount = (body.match(/<loc>/gi) ?? []).length;
    } else {
      sitemap.found = false;
    }
    delete sitemap.body;
  }
  return { robots, sitemap };
}

async function fetchFile(url: string, opts: RequestOptions): Promise<FetchedFile> {
  try {
    const res = await followRedirects(url, { ...opts, maxHops: 5 });
    const found = res.status >= 200 && res.status < 300;
    return found
      ? { url: res.finalUrl, status: res.status, found, body: res.body.slice(0, 500_000) }
      : { url, status: res.status, found };
  } catch {
    return { url, status: null, found: false };
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as Error & { cause?: { code?: string; message?: string } }).cause;
    return cause?.code ?? cause?.message ?? err.message;
  }
  return String(err);
}
