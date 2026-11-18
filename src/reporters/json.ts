import type { AuditReport } from '../types.ts';

export const screenshotFile = (width: number, mime: string) =>
  `screenshots/${width}.${mime === 'image/png' ? 'png' : 'jpg'}`;

/**
 * Serialises the report. Screenshot pixels are replaced by the relative path
 * that writeReport() saves them to, unless `inlineScreenshots` is set.
 */
export function toJson(report: AuditReport, opts: { inlineScreenshots?: boolean } = {}): string {
  const out = opts.inlineScreenshots
    ? report
    : {
        ...report,
        screenshots: report.screenshots.map(({ data: _data, ...rest }) => ({
          ...rest,
          file: screenshotFile(rest.width, rest.mime),
        })),
      };
  return `${JSON.stringify(out, null, 2)}\n`;
}
