import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { renderHtml } from '../src/reporters/html.ts';
const [, , name, out] = process.argv;
const r = JSON.parse(readFileSync(`${process.env.TEMP}/sfa-${name}.json`, 'utf8'));
const html = renderHtml(r, { preparedBy: { name: 'George Mikaelson', url: 'https://george-mikaelson.github.io/' } });
writeFileSync(`${out}/${name}.html`, html);
const b = await chromium.launch();
for (const w of [375, 1280]) {
  const p = await b.newPage({ viewport: { width: w, height: 900 } });
  await p.setContent(html);
  const ov = await p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  console.log(name, w, 'overflow', ov);
  await p.screenshot({ path: `${out}/${name}-${w}.png`, fullPage: true });
}
await b.close();
