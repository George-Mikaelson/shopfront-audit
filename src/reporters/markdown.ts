import type { AuditReport } from '../types.ts';
import { AREA_NAMES } from './html.ts';

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** Short GitHub-flavoured summary for PR comments and job summaries. */
export function renderMarkdown(
  report: AuditReport,
  opts: { topFixes?: number; reportUrl?: string } = {},
): string {
  const lines: string[] = [];
  const name = report.business?.name ?? report.finalUrl;
  lines.push(`### Website check-up: ${cell(name)}`);
  lines.push('');
  lines.push(
    `Grade **${report.grade}**, overall score **${report.overall ?? '–'}/100** for ${report.finalUrl}`,
  );
  lines.push('');
  lines.push('| Area | Score |');
  lines.push('| --- | ---: |');
  for (const a of report.areas)
    lines.push(`| ${AREA_NAMES[a.area]} | ${a.score ?? 'not checked'} |`);
  const top = report.findings.slice(0, opts.topFixes ?? 5);
  if (top.length > 0) {
    lines.push('');
    lines.push('**Fix these first**');
    lines.push('');
    top.forEach((f, i) => {
      lines.push(
        `${i + 1}. **${cell(f.title)}** (+${Math.max(0, Math.round(f.gain))} pts). ${cell(f.fix)}`,
      );
    });
  }
  if (opts.reportUrl) {
    lines.push('');
    lines.push(`[Full report](${opts.reportUrl})`);
  }
  lines.push('');
  lines.push(`<sub>${report.tool.name} ${report.tool.version}</sub>`);
  return `${lines.join('\n')}\n`;
}
