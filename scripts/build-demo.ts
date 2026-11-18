// Regenerates docs/examples/* and the README screenshots from the fixture sites.
// Usage: npm run demo
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { audit } from '../src/audit.ts';
import { renderHtml } from '../src/reporters/html.ts';
import { renderPdf } from '../src/reporters/write.ts';
import { BAD_BUSINESS, GOOD_BUSINESS } from '../test/support/businesses.ts';
import { startSite } from '../test/support/fixture-server.ts';

const docs = fileURLToPath(new URL('../docs/', import.meta.url));
await mkdir(`${docs}examples`, { recursive: true });
await mkdir(`${docs}assets`, { recursive: true });

const browser = await chromium.launch();
const preparedBy = { name: 'George Mikaelson', url: 'https://george-mikaelson.github.io/' };

for (const [name, business] of [
  ['bad', BAD_BUSINESS],
  ['good', GOOD_BUSINESS],
] as const) {
  const site = await startSite(name);
  try {
    const report = await audit({ url: site.url, business }, { browser });
    // The fixture runs on a random local port; show a stable placeholder instead.
    const html = renderHtml(report, { preparedBy })
      .replaceAll(site.url, `https://${name}-example.test/`)
      .replaceAll(new URL(site.url).host, `${name}-example.test`);
    await writeFile(`${docs}examples/${name}-site.html`, html);
    await writeFile(`${docs}examples/${name}-site.pdf`, await renderPdf(html, browser));
    console.log(`${name}: ${report.overall}/100 (${report.grade})`);

    for (const width of [375, 1280]) {
      const page = await browser.newPage({
        viewport: { width, height: width === 375 ? 1400 : 1500 },
        deviceScaleFactor: width === 375 ? 2 : 1,
      });
      await page.setContent(html);
      await page.screenshot({ path: `${docs}assets/${name}-report-${width}.png` });
      await page.close();
    }
  } finally {
    await site.close();
  }
}
await browser.close();
