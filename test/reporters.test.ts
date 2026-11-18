import { describe, expect, it } from 'vitest';
import { buildReport } from '../src/audit.ts';
import { renderHtml } from '../src/reporters/html.ts';
import { toJson } from '../src/reporters/json.ts';
import { renderMarkdown } from '../src/reporters/markdown.ts';
import { escapeHtml, meter } from '../src/reporters/svg.ts';
import { fixture, layout, makeEvidence } from './support/evidence.ts';

const badEvidence = makeEvidence({
  html: fixture('bad-restaurant.html'),
  text: 'Welcome\nCall us: 21 999 0000',
  layouts: [
    layout(375, { scrollWidth: 1100, layoutWidth: 980, scale: 0.34 }),
    layout(768),
    layout(1280),
  ],
  screenshots: [{ width: 375, height: 812, mime: 'image/jpeg', data: 'AAAA' }],
});
const business = { name: 'Café <script>alert(1)</script>', phone: '+351 21 234 5678' };
const report = buildReport(badEvidence, { business, startedAt: new Date('2026-11-18T10:00:00Z') });

describe('escapeHtml', () => {
  it('escapes markup and quotes', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });
});

describe('meter', () => {
  it('draws a bar proportional to the value with an accessible label', () => {
    const svg = meter(40, { label: 'Speed' });
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="Speed: 40 out of 100"');
    expect(svg).toMatch(/<rect[^>]+width="40%"/);
  });
});

describe('renderHtml', () => {
  const html = renderHtml(report);

  it('is a complete standalone document', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(html).toContain('</html>');
  });

  it('loads nothing from the network', () => {
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+href="https?:/i);
    expect(html).not.toMatch(/url\(["']?https?:/i);
  });

  it('escapes user-supplied text', () => {
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('Café &lt;script&gt;');
  });

  it('shows the grade and the score', () => {
    expect(html).toContain(`>${report.grade}<`);
    expect(html).toContain(`${report.overall}`);
  });

  it('lists the top fixes in priority order', () => {
    const first = report.findings[0];
    const second = report.findings[1];
    expect(first && second).toBeTruthy();
    expect(html.indexOf(escapeHtml(first?.title ?? ''))).toBeLessThan(
      html.indexOf(escapeHtml(second?.title ?? '')),
    );
  });

  it('embeds screenshots as data URIs', () => {
    expect(html).toContain('src="data:image/jpeg;base64,AAAA"');
  });

  it('credits whoever prepared the report when asked', () => {
    const credited = renderHtml(report, {
      preparedBy: { name: 'George Mikaelson', url: 'https://george-mikaelson.github.io/' },
    });
    expect(credited).toContain('George Mikaelson');
    expect(credited).toContain('href="https://george-mikaelson.github.io/"');
  });
});

describe('renderMarkdown', () => {
  it('summarises scores and the top fixes for a pull request comment', () => {
    const md = renderMarkdown(report);
    expect(md).toContain(`**${report.overall}/100**`);
    expect(md).toMatch(/\| Speed \|/);
    expect(md).toContain(report.findings[0]?.title ?? 'missing');
  });
});

describe('toJson', () => {
  it('drops screenshot data unless asked to keep it', () => {
    const parsed = JSON.parse(toJson(report)) as {
      screenshots: { data?: string; file?: string }[];
    };
    expect(parsed.screenshots[0]?.data).toBeUndefined();
    expect(parsed.screenshots[0]?.file).toBe('screenshots/375.jpg');
  });
});
