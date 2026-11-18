import type { AreaId, Check, Effort, Finding, Severity } from '../types.ts';

/** Builds a measured check; status follows the score (≥0.9 pass, ≥0.5 warn). */
export function measure(
  id: string,
  title: string,
  weight: number,
  score: number,
  detail: string,
): Check {
  const s = Math.min(1, Math.max(0, score));
  return {
    id,
    title,
    weight,
    score: s,
    status: s >= 0.9 ? 'pass' : s >= 0.5 ? 'warn' : 'fail',
    detail,
  };
}

export function skipped(id: string, title: string, weight: number, detail: string): Check {
  return { id, title, weight, score: 0, status: 'skip', detail };
}

export interface FindingInput {
  title: string;
  explanation: string;
  fix: string;
  severity: Severity;
  effort: Effort;
  share?: number;
  /** Suffix to keep ids unique when one check yields several findings. */
  key?: string;
}

/** Collects findings for one area so analyzers can stay declarative. */
export class FindingList {
  readonly items: Finding[] = [];
  private readonly area: AreaId;

  constructor(area: AreaId) {
    this.area = area;
  }

  add(check: Check, input: FindingInput): void {
    if (check.status === 'pass' || check.status === 'skip') return;
    const { key, share, ...rest } = input;
    this.items.push({
      id: key ? `${check.id}:${key}` : check.id,
      area: this.area,
      checkId: check.id,
      share: share ?? 1,
      ...rest,
    });
  }
}

export const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`;

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function formatSeconds(ms: number): string {
  const s = ms / 1000;
  return `${s >= 10 ? Math.round(s) : Math.round(s * 10) / 10} s`;
}

/**
 * Throughput used to turn file sizes into waiting times in plain-English
 * findings: a middling 4G connection (5 Mbit/s) plus 0.3 s of latency.
 */
export const PHONE_MBPS = 5;
export const downloadMs = (bytes: number): number => (bytes * 8) / (PHONE_MBPS * 1000) + 300;

/** Linear interpolation between a "good" and "poor" threshold (lower is better). */
export function lowerIsBetter(value: number, good: number, poor: number): number {
  if (value <= good) return 1;
  if (value >= poor) return 0;
  return 1 - (value - good) / (poor - good);
}

export function shortUrl(url: string, base?: string): string {
  try {
    const u = new URL(url, base);
    const b = base ? new URL(base) : undefined;
    const path = decodeURIComponent(u.pathname + u.search);
    return b && b.host === u.host ? path : `${u.host}${path === '/' ? '' : path}`;
  } catch {
    return url;
  }
}

/** Words for "menu" in the languages small restaurants around us use. */
export const MENU_WORDS = /menu|men[uú]|carta|card[aá]pio|speisekarte|carte|menukaart|karta/i;

export const isPdfUrl = (url: string): boolean => {
  try {
    return /\.pdf$/i.test(new URL(url, 'http://x').pathname);
  } catch {
    return false;
  }
};

/** A PDF that looks like the restaurant menu, judged by its address. */
export const isMenuPdf = (url: string): boolean => isPdfUrl(url) && MENU_WORDS.test(url);
