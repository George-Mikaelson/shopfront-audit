import { isIP } from 'node:net';

/** localhost, *.localhost, loopback and private (RFC 1918 / ULA) addresses. */
export function isLocalHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    return false;
  }
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  const kind = isIP(host);
  if (kind === 4) {
    const [a = 0, b = 0] = host.split('.').map(Number);
    return (
      a === 127 || a === 10 || a === 0 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)
    );
  }
  if (kind === 6) return host === '::1' || /^f[cd]/.test(host) || host.startsWith('fe80');
  return false;
}

/** Folder-safe slug: "Café São João" -> "cafe-sao-joao". URLs lose scheme and www. */
export function slugify(s: string): string {
  return s
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
}

/** Adds https:// when the user typed a bare domain. Throws on garbage. */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withScheme);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Only http(s) URLs can be audited, got ${url.protocol}`);
  }
  return url.href;
}
