/**
 * Hand-written SVG charts. No chart library: the report is one self-contained
 * file that must render offline, print, and pass through email attachments.
 * Colours come from CSS custom properties defined in html.ts, so dark mode and
 * print just work.
 */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export type Status = 'good' | 'warning' | 'serious' | 'critical' | 'none';

export function statusForScore(score: number | null): Status {
  if (score === null) return 'none';
  if (score >= 75) return 'good';
  if (score >= 60) return 'warning';
  if (score >= 40) return 'serious';
  return 'critical';
}

const pct = (n: number) => `${Math.round(Math.max(0, Math.min(100, n)) * 10) / 10}%`;

/** A 0–100 meter: recessive track, status-coloured fill with a rounded data end. */
export function meter(value: number | null, opts: { label: string; height?: number }): string {
  const h = opts.height ?? 10;
  const status = statusForScore(value);
  const v = value ?? 0;
  const aria = value === null ? `${opts.label}: not checked` : `${opts.label}: ${value} out of 100`;
  return (
    `<svg class="meter" role="img" aria-label="${escapeHtml(aria)}" width="100%" height="${h}" preserveAspectRatio="none">` +
    `<title>${escapeHtml(aria)}</title>` +
    `<rect class="meter-track" x="0" y="0" width="100%" height="${h}" rx="${h / 2}"/>` +
    (value === null || v <= 0
      ? ''
      : `<rect class="meter-fill s-${status}" x="0" y="0" width="${pct(v)}" height="${h}" rx="${h / 2}"/>`) +
    `</svg>`
  );
}

export interface BulletOptions {
  label: string;
  value: number;
  good: number;
  poor: number;
  /** Right end of the scale. */
  max: number;
  format: (n: number) => string;
}

/**
 * Core Web Vitals bullet: three zones (good / needs work / poor) from Google's
 * thresholds and a marker at the measured value. Values past `max` are pinned
 * to the end with an arrow so a 24 s LCP does not squash the scale.
 */
export function bullet(o: BulletOptions): string {
  const x = (n: number) => pct((Math.min(n, o.max) / o.max) * 100);
  const status = o.value <= o.good ? 'good' : o.value <= o.poor ? 'warning' : 'critical';
  const verdict = status === 'good' ? 'good' : status === 'warning' ? 'needs work' : 'poor';
  const aria = `${o.label}: ${o.format(o.value)}, ${verdict} (good is under ${o.format(o.good)})`;
  const clipped = o.value > o.max;
  return (
    `<svg class="bullet" role="img" aria-label="${escapeHtml(aria)}" width="100%" height="30">` +
    `<title>${escapeHtml(aria)}</title>` +
    `<rect class="zone z-good" x="0" y="8" width="${x(o.good)}" height="10"/>` +
    `<rect class="zone z-warning" x="${x(o.good)}" y="8" width="${pct(((Math.min(o.poor, o.max) - o.good) / o.max) * 100)}" height="10"/>` +
    `<rect class="zone z-critical" x="${x(o.poor)}" y="8" width="${pct(((o.max - Math.min(o.poor, o.max)) / o.max) * 100)}" height="10"/>` +
    `<line class="zone-gap" x1="${x(o.good)}" x2="${x(o.good)}" y1="6" y2="20"/>` +
    `<line class="zone-gap" x1="${x(o.poor)}" x2="${x(o.poor)}" y1="6" y2="20"/>` +
    `<rect class="marker" x="${x(o.value)}" y="2" width="4" height="22" rx="2" transform="translate(-2 0)"/>` +
    (clipped ? `<text class="clip" x="100%" y="29" text-anchor="end">off the scale</text>` : '') +
    `</svg>`
  );
}

export interface BarItem {
  label: string;
  value: number;
  display: string;
}

/** Horizontal bars for a short ranked list (largest downloads). One hue. */
export function barList(items: BarItem[], caption: string): string {
  const max = Math.max(1, ...items.map((i) => i.value));
  const rows = items
    .map(
      (i) =>
        `<div class="bar-row"><span class="bar-label" title="${escapeHtml(i.label)}">${escapeHtml(i.label)}</span>` +
        `<svg class="bar" role="img" aria-label="${escapeHtml(`${i.label}: ${i.display}`)}" width="100%" height="12">` +
        `<title>${escapeHtml(`${i.label}: ${i.display}`)}</title>` +
        `<rect class="bar-fill" x="0" y="0" width="${pct(Math.max(1, (i.value / max) * 100))}" height="12" rx="3"/></svg>` +
        `<span class="bar-value">${escapeHtml(i.display)}</span></div>`,
    )
    .join('');
  return `<figure class="bars"><figcaption>${escapeHtml(caption)}</figcaption>${rows}</figure>`;
}
