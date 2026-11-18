import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 375, height: 900 } });
await p.setContent(readFileSync(process.argv[2]!, 'utf8'));
console.log(await p.evaluate(() => Array.from(document.querySelectorAll('body *')).filter(e => e.getBoundingClientRect().right > 376).slice(0, 8).map(e => e.tagName + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().right) + ' ' + (e.textContent ?? '').slice(0, 60))));
for (const [i, y] of [[0, 0], [1, 900], [2, 1800]] as const) { await p.evaluate((yy) => scrollTo(0, yy), y); await p.screenshot({ path: `${process.argv[3]}/m${i}.png` }); }
await b.close();
