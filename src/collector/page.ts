import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Browser, BrowserContext, Page } from 'playwright';
import { MIN_TAP_PX, MIN_TEXT_PX } from '../analyzers/mobile.ts';
import type { AxeSummary, AxeViolation, Screenshot, ViewportLayout } from '../types.ts';
import { USER_AGENT } from '../version.ts';
import { layoutProbe } from './probes/layout.ts';

export const VIEWPORTS = [
  { width: 375, height: 812, mobile: true, scale: 2 },
  { width: 768, height: 1024, mobile: true, scale: 1 },
  { width: 1280, height: 800, mobile: false, scale: 1 },
] as const;

export interface PageProbeResult {
  html: string;
  text: string;
  layouts: ViewportLayout[];
  screenshots: Screenshot[];
  axe: AxeSummary | null;
  errors: string[];
}

const require = createRequire(import.meta.url);
let axeSource: string | undefined;
const loadAxe = (): string =>
  (axeSource ??= readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'));

/**
 * Opens the page at each viewport in its own context, measures layout,
 * takes a screenshot, and on desktop runs axe-core and grabs the DOM.
 */
export async function probePage(
  browser: Browser,
  url: string,
  opts: { timeoutMs?: number; screenshots?: boolean } = {},
): Promise<PageProbeResult> {
  const timeout = opts.timeoutMs ?? 30_000;
  const result: PageProbeResult = {
    html: '',
    text: '',
    layouts: [],
    screenshots: [],
    axe: null,
    errors: [],
  };

  for (const vp of VIEWPORTS) {
    let context: BrowserContext | undefined;
    try {
      context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        screen: { width: vp.width, height: vp.height },
        deviceScaleFactor: vp.scale,
        isMobile: vp.mobile,
        hasTouch: vp.mobile,
        userAgent: `${USER_AGENT}${vp.mobile ? ' Mobile' : ''}`,
        serviceWorkers: 'block',
      });
      const page = await context.newPage();
      await load(page, url, timeout);

      const layout = await page.evaluate(layoutProbe, { minTap: MIN_TAP_PX, minText: MIN_TEXT_PX });
      result.layouts.push({ width: vp.width, ...layout });

      if (opts.screenshots !== false) {
        const data = await page.screenshot({ type: 'jpeg', quality: 72, fullPage: false, timeout });
        result.screenshots.push({
          width: vp.width,
          height: vp.height,
          mime: 'image/jpeg',
          data: data.toString('base64'),
        });
      }

      if (!vp.mobile) {
        result.html = await page.content();
        result.text = await page.evaluate(() => document.body.innerText);
        try {
          result.axe = await runAxe(page);
        } catch (err) {
          result.errors.push(`Accessibility scan failed: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      result.errors.push(
        `Could not render at ${vp.width}px: ${(err as Error).message.split('\n')[0] ?? ''}`,
      );
    } finally {
      await context?.close();
    }
  }
  return result;
}

async function load(page: Page, url: string, timeout: number): Promise<void> {
  await page.goto(url, { waitUntil: 'load', timeout });
  // Let late scripts and fonts settle, but never wait forever on chatty pages.
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
  await page.waitForTimeout(300);
}

interface RawAxeResult {
  violations: {
    id: string;
    impact?: AxeViolation['impact'];
    help: string;
    description: string;
    helpUrl: string;
    nodes: { target: unknown[]; html: string }[];
  }[];
  passes: unknown[];
  incomplete: unknown[];
  testEngine: { version: string };
}

async function runAxe(page: Page): Promise<AxeSummary> {
  await page.addScriptTag({ content: loadAxe() });
  const raw = await page.evaluate(async () => {
    const axe = (
      window as unknown as { axe: { run: (ctx: Document, opts: object) => Promise<unknown> } }
    ).axe;
    return axe.run(document, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
      },
      resultTypes: ['violations'],
    });
  });
  const r = raw as RawAxeResult;
  return {
    violations: r.violations.map((v) => ({
      id: v.id,
      impact: v.impact ?? null,
      help: v.help,
      description: v.description,
      helpUrl: v.helpUrl,
      nodeCount: v.nodes.length,
      nodes: v.nodes
        .slice(0, 5)
        .map((n) => ({ target: n.target.map(String).join(' '), html: n.html.slice(0, 200) })),
    })),
    passes: r.passes.length,
    incomplete: r.incomplete.length,
    axeVersion: r.testEngine.version,
  };
}
