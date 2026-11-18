import { formatBytes, formatSeconds, shortUrl } from '../analyzers/util.ts';
import type { AreaId, AuditReport, Check, Effort, Grade, RankedFinding, ScoredArea, Screenshot } from '../types.ts';
import { barList, bullet, escapeHtml as e, meter, statusForScore } from './svg.ts';

export interface HtmlOptions {
  /** Shown in the footer, e.g. the web designer sending the report. */
  preparedBy?: { name: string; url?: string; email?: string };
  /** How many fixes to put at the top. */
  topFixes?: number;
}

export const AREA_NAMES: Record<AreaId, string> = {
  performance: 'Speed',
  mobile: 'Phones and tablets',
  seo: 'Google and search',
  accessibility: 'Accessibility',
  nap: 'Name, address and phone',
};

const AREA_BLURB: Record<AreaId, string> = {
  performance: 'How quickly the page shows up on a phone connection.',
  mobile: 'Whether the page fits small screens and is easy to tap and read.',
  seo: 'Whether Google can find the site, trust it and show your details.',
  accessibility: 'Whether people with poor eyesight or screen readers can use it.',
  nap: 'Whether the site agrees with your listing on maps and directories.',
};

const VERDICT: Record<Grade, string> = {
  A: 'Your website is in very good shape.',
  B: 'Your website works well. A few fixes would make it better.',
  C: 'Your website works, but some problems are costing you customers.',
  D: 'Your website has problems that send customers elsewhere.',
  F: 'Your website is turning most customers away.',
  '?': 'We could not measure enough to give a grade.',
};

const EFFORT: Record<Effort, string> = {
  quick: 'Quick fix',
  moderate: 'Some work',
  major: 'Bigger job',
};

const STATUS_TEXT: Record<Check['status'], string> = {
  pass: 'Pass',
  warn: 'Needs work',
  fail: 'Problem',
  skip: 'Not checked',
};

const STATUS_ICON: Record<Check['status'], string> = {
  pass: '<path d="M4 8.5l2.5 2.5L12 5.5"/>',
  warn: '<path d="M8 4v5"/><path d="M8 11.5v.5"/>',
  fail: '<path d="M5 5l6 6M11 5l-6 6"/>',
  skip: '<path d="M4.5 8h7"/>',
};

const icon = (s: Check['status']) =>
  `<svg class="icon i-${s}" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">${STATUS_ICON[s]}</svg>`;

/** The full, standalone report page. */
export function renderHtml(report: AuditReport, opts: HtmlOptions = {}): string {
  const name = report.business?.name?.trim() || hostOf(report.finalUrl);
  const date = new Date(report.auditedAt);
  const dateText = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const top = report.findings.slice(0, opts.topFixes ?? 5);
  const rest = report.findings.slice(top.length);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="generator" content="${e(report.tool.name)} ${e(report.tool.version)}">
<title>Website check-up: ${e(name)}</title>
<style>${CSS}</style>
</head>
<body>
<main class="page">
  <header class="masthead">
    <p class="kicker">Website check-up</p>
    <h1>${e(name)}</h1>
    <p class="meta"><a href="${e(report.finalUrl)}">${e(shortUrl(report.finalUrl))}</a><span>Checked on ${e(dateText)}</span></p>
  </header>

  <section class="verdict" aria-labelledby="verdict-title">
    <div class="placard s-${statusForScore(report.overall)}" aria-label="Grade ${e(report.grade)}">
      <span class="placard-label">Grade</span>
      <span class="placard-letter">${e(report.grade)}</span>
      <span class="placard-score">${report.overall ?? '–'}<small>/100</small></span>
    </div>
    <div class="verdict-text">
      <h2 id="verdict-title">${e(VERDICT[report.grade])}</h2>
      <p>${summarySentence(report)}</p>
      <div class="areas">${report.areas.map(areaRow).join('')}</div>
    </div>
  </section>

  ${top.length > 0 ? fixesSection(top, report) : ''}

  ${screensSection(report)}

  ${speedSection(report)}

  <section class="details" aria-labelledby="details-title">
    <h2 id="details-title">Everything we checked</h2>
    ${report.areas.map((a) => areaDetails(a)).join('')}
    ${rest.length > 0 ? moreFixes(rest) : ''}
  </section>

  <footer class="colophon">
    ${opts.preparedBy ? preparedBy(opts.preparedBy) : ''}
    <h2>How to read this report</h2>
    <p>Each area gets a score from 0 to 100: the weighted share of its checks that passed. The overall score
    combines them (speed 30%, phones 25%, search 20%, accessibility 15%, name/address/phone 10%), leaving out
    anything we could not measure. “Points” next to a fix is how much the overall score would rise if that
    problem went away.</p>
    <p>Speed is measured with Google Lighthouse on a simulated mid-range phone with a slow 4G connection, so
    the same page can score a few points differently from one run to the next. Download times assume a
    typical 5&nbsp;Mbit/s phone connection.</p>
    ${report.warnings.length > 0 ? `<p class="warnings">Some steps did not complete: ${report.warnings.map(e).join('; ')}</p>` : ''}
    <p class="tool">Made with ${e(report.tool.name)} ${e(report.tool.version)} in ${Math.max(1, Math.round(report.durationMs / 1000))} s.
    Free and open source: github.com/George-Mikaelson/shopfront-audit</p>
  </footer>
</main>
</body>
</html>
`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function summarySentence(r: AuditReport): string {
  const problems = r.findings.length;
  if (problems === 0) return 'We found nothing that needs fixing.';
  const worst = [...r.areas].filter((a) => a.score !== null).sort((a, b) => (a.score ?? 0) - (b.score ?? 0))[0];
  const quick = r.findings.filter((f) => f.effort === 'quick').length;
  const parts = [`We found ${problems} ${problems === 1 ? 'thing' : 'things'} to fix`];
  if (worst && (worst.score ?? 100) < 75) parts.push(`the weakest area is ${AREA_NAMES[worst.area].toLowerCase()}`);
  let s = `${parts.join('; ')}.`;
  if (quick > 0) s += ` ${quick} of them ${quick === 1 ? 'is a quick fix' : 'are quick fixes'}.`;
  return e(s);
}

function areaRow(a: ScoredArea): string {
  return `<div class="area-row">
    <span class="area-name">${e(AREA_NAMES[a.area])}</span>
    ${meter(a.score, { label: AREA_NAMES[a.area] })}
    <span class="area-score">${a.score === null ? '<span class="na">Not checked</span>' : `${a.score}`}</span>
  </div>`;
}

function fixesSection(top: RankedFinding[], report: AuditReport): string {
  const items = top
    .map(
      (f) => `<li class="fix sev-${f.severity}">
      <div class="fix-body">
        <h3>${e(f.title)}</h3>
        <p>${e(f.explanation)}</p>
        <p class="todo"><strong>What to do:</strong> ${e(f.fix)}</p>
      </div>
      <dl class="fix-meta">
        <div><dt>Score gain</dt><dd class="gain">+${formatGain(f.gain)}</dd></div>
        <div><dt>Effort</dt><dd>${EFFORT[f.effort]}</dd></div>
        <div><dt>Area</dt><dd>${e(AREA_NAMES[f.area])}</dd></div>
      </dl>
    </li>`,
    )
    .join('');
  const total = Math.min(100 - (report.overall ?? 0), Math.round(top.reduce((s, f) => s + f.gain, 0)));
  return `<section class="fixes" aria-labelledby="fixes-title">
    <h2 id="fixes-title">Fix these first</h2>
    <p class="section-lede">Ordered by how much each one helps. Together they are worth about ${total} points.</p>
    <ol>${items}</ol>
  </section>`;
}

function formatGain(n: number): string {
  return n >= 1 ? `${Math.round(n)} pts` : '<1 pt';
}

function screensSection(r: AuditReport): string {
  if (r.screenshots.length === 0) return '';
  const caption = (s: Screenshot): string => {
    const l = r.evidence.layouts.find((x) => x.width === s.width);
    const device = s.width < 600 ? 'Phone' : s.width < 1000 ? 'Tablet' : 'Computer';
    const notes: string[] = [];
    if (l && l.scrollWidth > l.layoutWidth + 1) notes.push('scrolls sideways');
    if (l && l.scale < 0.9) notes.push('shrunk to fit');
    if (l && l.text.totalChars > 0 && l.text.smallChars / l.text.totalChars > 0.25) notes.push('text too small');
    return `<figcaption><strong>${device}</strong> ${s.width} px${notes.length > 0 ? `<span class="flag">${e(notes.join(', '))}</span>` : '<span class="ok">fits</span>'}</figcaption>`;
  };
  const shots = [...r.screenshots]
    .sort((a, b) => a.width - b.width)
    .map(
      (s) => `<figure class="shot w${s.width}">
        <div class="frame"><img src="data:${s.mime};base64,${s.data}" alt="${e(`The home page on a ${s.width} px wide screen`)}" loading="lazy"></div>
        ${caption(s)}
      </figure>`,
    )
    .join('');
  return `<section class="screens" aria-labelledby="screens-title">
    <h2 id="screens-title">What visitors see first</h2>
    <p class="section-lede">The top of your home page as it loads on three common screen sizes.</p>
    <div class="shots">${shots}</div>
  </section>`;
}

function speedSection(r: AuditReport): string {
  const m = r.evidence.lighthouse.mobile;
  if (!m) return '';
  const rows: string[] = [];
  if (m.metrics.lcp !== null) {
    rows.push(vital('Main content visible', 'Largest Contentful Paint', bullet({ label: 'Main content visible', value: m.metrics.lcp, good: 2500, poor: 4000, max: 10000, format: formatSeconds }), formatSeconds(m.metrics.lcp)));
  }
  if (m.metrics.tbt !== null) {
    rows.push(vital('Frozen while loading', 'Total Blocking Time', bullet({ label: 'Frozen while loading', value: m.metrics.tbt, good: 200, poor: 600, max: 2000, format: (n) => `${Math.round(n)} ms` }), `${Math.round(m.metrics.tbt)} ms`));
  }
  if (m.metrics.cls !== null) {
    rows.push(vital('Page jumping around', 'Cumulative Layout Shift', bullet({ label: 'Page jumping around', value: m.metrics.cls, good: 0.1, poor: 0.25, max: 0.5, format: (n) => n.toFixed(2) }), m.metrics.cls.toFixed(2)));
  }
  const resources = m.largestResources.slice(0, 5).map((res) => ({
    label: shortUrl(res.url, r.finalUrl),
    value: res.bytes,
    display: formatBytes(res.bytes),
  }));
  return `<section class="speed" aria-labelledby="speed-title">
    <h2 id="speed-title">Speed on a phone</h2>
    <p class="section-lede">Measured on a simulated mid-range phone over slow 4G.${m.totalBytes !== null ? ` The home page downloads ${formatBytes(m.totalBytes)} in total.` : ''}</p>
    <div class="vitals">
      ${rows.join('')}
      <p class="legend"><span class="key k-good"></span>Good <span class="key k-warning"></span>Needs work <span class="key k-critical"></span>Poor</p>
    </div>
    ${resources.length > 0 ? barList(resources, 'Biggest downloads on the home page') : ''}
  </section>`;
}

function vital(name: string, tech: string, chart: string, value: string): string {
  return `<div class="vital"><div class="vital-head"><span>${e(name)} <small>${e(tech)}</small></span><strong>${e(value)}</strong></div>${chart}</div>`;
}

function areaDetails(a: ScoredArea): string {
  const rows = a.checks
    .map(
      (c) => `<tr class="st-${c.status}">
      <td class="st">${icon(c.status)}<span>${STATUS_TEXT[c.status]}</span></td>
      <th scope="row">${e(c.title)}</th>
      <td>${e(c.detail)}</td>
    </tr>`,
    )
    .join('');
  return `<section class="area-detail">
    <div class="area-head">
      <h3>${e(AREA_NAMES[a.area])}</h3>
      <span class="area-head-score">${a.score === null ? 'Not checked' : `${a.score}/100`}</span>
    </div>
    <p class="area-blurb">${e(a.skippedReason ?? AREA_BLURB[a.area])}</p>
    ${rows ? `<div class="table-wrap"><table><thead><tr><th scope="col">Result</th><th scope="col">Check</th><th scope="col">What we found</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
  </section>`;
}

function moreFixes(rest: RankedFinding[]): string {
  return `<section class="more-fixes">
    <h3>Other things to fix</h3>
    <ul>${rest.map((f) => `<li><strong>${e(f.title)}.</strong> ${e(f.fix)}</li>`).join('')}</ul>
  </section>`;
}

function preparedBy(p: NonNullable<HtmlOptions['preparedBy']>): string {
  const link = p.url ? `<a href="${e(p.url)}">${e(p.name)}</a>` : e(p.name);
  const mail = p.email ? ` You can reach me at <a href="mailto:${e(p.email)}">${e(p.email)}</a>.` : '';
  return `<div class="prepared"><p>Prepared by ${link}. I am happy to walk you through any of this.${mail}</p></div>`;
}

const CSS = /* css */ `
:root {
  --paper: #f4f6f8;
  --sheet: #ffffff;
  --ink: #1b2440;
  --ink-2: #48506a;
  --muted: #6b728a;
  --rule: #d8dde6;
  --rule-strong: #b9c0cd;
  --accent: #2343a8;
  --track: #e6e9ef;
  --good: #0ca30c;
  --warning: #fab219;
  --serious: #ec835a;
  --critical: #d03b3b;
  --good-ink: #0a6b0a;
  --warning-ink: #8a5a00;
  --serious-ink: #a4471f;
  --critical-ink: #b3261e;
  --display: 'Bahnschrift', 'DIN Alternate', 'DIN 2014', 'Barlow Semi Condensed', 'Roboto Condensed', 'Arial Narrow', sans-serif;
  --body: 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Roboto, Arial, sans-serif;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    --paper: #12151d;
    --sheet: #1a1e29;
    --ink: #eceef4;
    --ink-2: #c3c8d6;
    --muted: #9399ab;
    --rule: #2d3342;
    --rule-strong: #434a5c;
    --accent: #8ea8ff;
    --track: #2a3040;
    --good-ink: #4cc94c;
    --warning-ink: #fab219;
    --serious-ink: #f09a77;
    --critical-ink: #f07a7a;
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 16px/1.55 var(--body); }
a { color: var(--accent); text-underline-offset: 2px; }
a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 2px; }
h1, h2, h3 { font-family: var(--display); font-stretch: 87.5%; line-height: 1.15; margin: 0; letter-spacing: 0; }
h2 { font-size: 1.6rem; font-weight: 600; }
h3 { font-size: 1.2rem; font-weight: 600; }
p { margin: 0; }
.page { width: 100%; max-width: 1040px; margin: 0 auto; padding: 32px 16px 64px; }
@media (min-width: 768px) { .page { padding: 48px 32px 80px; } }

.masthead { border-bottom: 3px solid var(--ink); padding-bottom: 16px; margin-bottom: 28px; }
.kicker { font-family: var(--display); font-size: 1.05rem; color: var(--ink-2); }
.masthead h1 { font-size: clamp(2.2rem, 7vw, 3.6rem); font-weight: 700; margin: 2px 0 10px; overflow-wrap: anywhere; }
.meta { display: flex; flex-wrap: wrap; gap: 4px 20px; color: var(--ink-2); font-size: .95rem; }
.meta a { overflow-wrap: anywhere; }

.verdict { display: grid; gap: 24px; align-items: start; background: var(--sheet); border: 1px solid var(--rule); border-radius: 6px; padding: 20px; }
@media (min-width: 768px) { .verdict { grid-template-columns: 220px 1fr; gap: 36px; padding: 28px; } }
.placard { display: grid; justify-items: center; align-content: center; gap: 2px; aspect-ratio: 1 / 1; max-width: 220px; width: 100%; margin: 0 auto;
  border: 6px double var(--ink); border-radius: 4px; padding: 12px; background: var(--sheet); }
.placard-label { font-family: var(--display); font-size: 1.1rem; color: var(--ink-2); }
.placard-letter { font-family: var(--display); font-weight: 700; font-size: 7.5rem; line-height: .9; }
.placard.s-good .placard-letter { color: var(--good-ink); }
.placard.s-warning .placard-letter { color: var(--warning-ink); }
.placard.s-serious .placard-letter { color: var(--serious-ink); }
.placard.s-critical .placard-letter { color: var(--critical-ink); }
.placard-score { font-family: var(--display); font-size: 1.5rem; font-weight: 600; font-variant-numeric: tabular-nums; }
.placard-score small { font-size: .9rem; color: var(--muted); font-weight: 400; }
.verdict-text h2 { font-size: clamp(1.5rem, 4vw, 2rem); margin-bottom: 8px; }
.verdict-text > p { color: var(--ink-2); max-width: 60ch; }
.areas { margin-top: 20px; display: grid; gap: 10px; }
.area-row { display: grid; grid-template-columns: minmax(0, 1fr) 44px; grid-template-areas: 'name score' 'bar bar'; gap: 4px 12px; align-items: center; }
@media (min-width: 560px) { .area-row { grid-template-columns: 200px minmax(0, 1fr) 72px; grid-template-areas: 'name bar score'; } }
.area-name { grid-area: name; font-size: .95rem; }
.area-row .meter { grid-area: bar; display: block; }
.area-score { grid-area: score; text-align: right; font-family: var(--display); font-weight: 600; font-size: 1.15rem; font-variant-numeric: tabular-nums; }
.na { font-family: var(--body); font-weight: 400; font-size: .8rem; color: var(--muted); }
.meter-track { fill: var(--track); }
.s-good { fill: var(--good); } .s-warning { fill: var(--warning); } .s-serious { fill: var(--serious); } .s-critical { fill: var(--critical); }

section + section, .verdict + section { margin-top: 44px; }
.section-lede { color: var(--ink-2); margin: 6px 0 18px; max-width: 65ch; }

.fixes ol { list-style: none; counter-reset: fix; margin: 0; padding: 0; display: grid; gap: 12px; }
.fix { counter-increment: fix; display: grid; gap: 12px 24px; background: var(--sheet); border: 1px solid var(--rule); border-left: 6px solid var(--rule-strong);
  border-radius: 6px; padding: 18px 18px 18px 64px; position: relative; break-inside: avoid; }
.fix::before { content: counter(fix); position: absolute; left: 18px; top: 14px; font-family: var(--display); font-weight: 700; font-size: 2rem; line-height: 1; color: var(--ink); }
.fix.sev-critical { border-left-color: var(--critical); }
.fix.sev-high { border-left-color: var(--serious); }
.fix.sev-medium { border-left-color: var(--warning); }
@media (min-width: 768px) { .fix { grid-template-columns: 1fr 150px; } }
.fix h3 { font-size: 1.3rem; margin-bottom: 6px; }
.fix-body p { max-width: 66ch; color: var(--ink-2); }
.fix-body .todo { margin-top: 8px; color: var(--ink); }
.fix-meta { margin: 0; display: flex; flex-wrap: wrap; gap: 6px 20px; align-content: start; font-size: .85rem; }
@media (min-width: 768px) { .fix-meta { flex-direction: column; border-left: 1px solid var(--rule); padding-left: 16px; } }
.fix-meta dt { color: var(--muted); }
.fix-meta dd { margin: 0; font-weight: 600; }
.fix-meta .gain { font-family: var(--display); font-size: 1.35rem; color: var(--good-ink); }

.shots { display: grid; grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.3fr); gap: 16px; align-items: end; }
.shot.w1280 { grid-column: 1 / -1; }
@media (min-width: 768px) { .shots { grid-template-columns: minmax(0, 0.62fr) minmax(0, 1fr) minmax(0, 2fr); gap: 24px; } .shot.w1280 { grid-column: auto; } }
.shot { margin: 0; }
.frame { border: 1px solid var(--rule-strong); border-radius: 10px; overflow: hidden; background: var(--sheet); box-shadow: 0 1px 2px rgba(20, 30, 60, .08); }
.shot.w375 .frame { border-radius: 18px; border-width: 6px; border-color: var(--ink); }
.shot.w768 .frame { border-radius: 14px; border-width: 6px; border-color: var(--ink); }
.frame img { display: block; width: 100%; height: auto; }
.shot figcaption { margin-top: 8px; font-size: .9rem; display: flex; flex-wrap: wrap; gap: 2px 8px; align-items: baseline; }
.flag { color: var(--critical-ink); font-weight: 600; }
.ok { color: var(--good-ink); }

.vitals { display: grid; gap: 14px; background: var(--sheet); border: 1px solid var(--rule); border-radius: 6px; padding: 18px; }
.vital-head { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
.vital-head small { color: var(--muted); font-size: .8rem; margin-left: 6px; }
.vital-head strong { font-family: var(--display); font-size: 1.2rem; font-variant-numeric: tabular-nums; }
.bullet { display: block; overflow: visible; }
.zone { opacity: .32; } .z-good { fill: var(--good); } .z-warning { fill: var(--warning); } .z-critical { fill: var(--critical); }
.zone-gap { stroke: var(--sheet); stroke-width: 2; }
.marker { fill: var(--ink); stroke: var(--sheet); stroke-width: 2; }
.clip { fill: var(--muted); font-size: 10px; font-family: var(--body); }
.legend { font-size: .8rem; color: var(--ink-2); display: flex; flex-wrap: wrap; gap: 4px 14px; align-items: center; }
.key { display: inline-block; width: 12px; height: 8px; border-radius: 2px; margin-right: -8px; opacity: .6; }
.k-good { background: var(--good); } .k-warning { background: var(--warning); } .k-critical { background: var(--critical); }
.bars { margin: 18px 0 0; display: grid; gap: 8px; }
.bars figcaption { font-weight: 600; margin-bottom: 2px; }
.bar-row { display: grid; grid-template-columns: minmax(0, 1fr) 64px; grid-template-areas: 'label value' 'bar bar'; gap: 2px 12px; align-items: center; font-size: .9rem; }
@media (min-width: 560px) { .bar-row { grid-template-columns: minmax(0, 220px) minmax(0, 1fr) 72px; grid-template-areas: 'label bar value'; } }
.bar-label { grid-area: label; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink-2); }
.bar { grid-area: bar; display: block; }
.bar-fill { fill: var(--accent); }
.bar-value { grid-area: value; text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }

.area-detail { margin-top: 26px; }
.area-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; border-bottom: 2px solid var(--ink); padding-bottom: 4px; }
.area-head-score { font-family: var(--display); font-weight: 600; font-variant-numeric: tabular-nums; }
.area-blurb { color: var(--ink-2); font-size: .95rem; margin: 6px 0 4px; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: .92rem; }
thead th { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
td, tbody th { padding: 9px 10px 9px 0; border-bottom: 1px solid var(--rule); vertical-align: top; text-align: left; }
tbody th { font-weight: 600; width: 34%; }
td.st { width: 120px; white-space: nowrap; }
td.st span { margin-left: 6px; }
.icon { vertical-align: -3px; fill: none; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
.i-pass { stroke: var(--good-ink); } .i-warn { stroke: var(--warning-ink); } .i-fail { stroke: var(--critical-ink); } .i-skip { stroke: var(--muted); }
.st-pass td.st { color: var(--good-ink); } .st-warn td.st { color: var(--warning-ink); } .st-fail td.st { color: var(--critical-ink); } .st-skip td.st, .st-skip td, .st-skip th { color: var(--muted); }
@media (max-width: 559.98px) {
  table, tbody, tr, td, tbody th { display: block; width: auto; }
  tr { padding: 10px 0; border-bottom: 1px solid var(--rule); }
  td, tbody th { border: 0; padding: 2px 0; }
  td.st { width: auto; }
}
.more-fixes { margin-top: 30px; }
.more-fixes ul { padding-left: 20px; display: grid; gap: 8px; color: var(--ink-2); }
.more-fixes strong { color: var(--ink); }

.colophon { margin-top: 56px; border-top: 3px solid var(--ink); padding-top: 18px; color: var(--ink-2); font-size: .9rem; display: grid; gap: 10px; }
.colophon h2 { font-size: 1.2rem; color: var(--ink); }
.colophon p { max-width: 75ch; }
.prepared { background: var(--sheet); border: 1px solid var(--rule); border-radius: 6px; padding: 14px 16px; color: var(--ink); font-size: 1rem; margin-bottom: 8px; }
.tool { color: var(--muted); }
.warnings { color: var(--warning-ink); }

@page { size: A4; margin: 14mm 12mm; }
@media print {
  :root { --paper: #fff; color-scheme: light; }
  body { background: #fff; font-size: 11pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { max-width: none; padding: 0; }
  .verdict { grid-template-columns: 190px 1fr; gap: 28px; padding: 18px; }
  .fix { grid-template-columns: 1fr 130px; }
  .fix-meta { flex-direction: column; border-left: 1px solid var(--rule); padding-left: 14px; }
  .shots { grid-template-columns: 0.62fr 1fr 2fr; }
  .shot.w1280 { grid-column: auto; }
  .area-row { grid-template-columns: 200px 1fr 60px; grid-template-areas: 'name bar score'; }
  .screens, .speed, .area-detail, .vitals, .verdict { break-inside: avoid; }
  a { color: inherit; text-decoration: none; }
}
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }
`;
