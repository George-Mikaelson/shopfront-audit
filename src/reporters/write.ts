import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Browser } from 'playwright';
import { launchBrowser } from '../collector/index.ts';
import type { AuditReport } from '../types.ts';
import { renderHtml, type HtmlOptions } from './html.ts';
import { screenshotFile, toJson } from './json.ts';
import { renderMarkdown } from './markdown.ts';

export type Format = 'html' | 'json' | 'md' | 'pdf';
export const FORMATS: readonly Format[] = ['html', 'json', 'md', 'pdf'];

export interface WriteOptions extends HtmlOptions {
  formats?: readonly Format[];
  /** Reused for PDF printing; one is launched (and closed) otherwise. */
  browser?: Browser;
}

/** Prints the HTML report to an A4 PDF with Chromium. */
export async function renderPdf(html: string, browser?: Browser): Promise<Buffer> {
  const own = browser ? undefined : await launchBrowser();
  const b = browser ?? (own as Browser);
  const context = await b.newContext({ colorScheme: 'light' });
  try {
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print', colorScheme: 'light' });
    return await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
  } finally {
    await context.close();
    await own?.close();
  }
}

/** Writes report.{html,json,md,pdf} and the screenshots into `dir`. Returns the paths written. */
export async function writeReport(report: AuditReport, dir: string, opts: WriteOptions = {}): Promise<string[]> {
  const formats = opts.formats ?? ['html', 'json'];
  await mkdir(dir, { recursive: true });
  const written: string[] = [];
  const out = async (name: string, data: string | Buffer) => {
    const path = join(dir, name);
    await writeFile(path, data);
    written.push(path);
  };

  const html = formats.includes('html') || formats.includes('pdf') ? renderHtml(report, opts) : '';
  if (formats.includes('html')) await out('report.html', html);
  if (formats.includes('json')) {
    await mkdir(join(dir, 'screenshots'), { recursive: true });
    for (const s of report.screenshots) {
      await out(screenshotFile(s.width, s.mime), Buffer.from(s.data, 'base64'));
    }
    await out('report.json', toJson(report));
  }
  if (formats.includes('md')) await out('report.md', renderMarkdown(report));
  if (formats.includes('pdf')) await out('report.pdf', await renderPdf(html, opts.browser));
  return written;
}
