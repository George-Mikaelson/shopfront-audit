import { audit } from '../src/audit.ts';
import { startSite } from '../test/support/fixture-server.ts';
import { writeFileSync } from 'node:fs';
for (const name of ['good', 'bad'] as const) {
  const site = await startSite(name);
  const t = Date.now();
  const r = await audit({ url: site.url, business: name === 'good' ? { name: 'Bistro Verde', address: 'Rua das Flores 12, 1200-195 Lisboa', phone: '+351 21 234 5678' } : { name: 'Trattoria Da Mario', address: 'Via Roma 45, 00184 Roma', phone: '+39 06 1234 5678' } }, { lighthouse: process.argv[2] !== 'nolh' });
  console.log(name, Date.now() - t, 'ms overall', r.overall, r.areas.map(a => `${a.area}:${a.score}`).join(' '));
  for (const a of r.areas) for (const c of a.checks) if (c.status !== 'pass') console.log('  ', c.status, c.id, c.detail);
  console.log('  layouts', JSON.stringify(r.evidence.layouts.map(l => ({w: l.width, lw: l.layoutWidth, sw: l.scrollWidth, s: l.scale, tt: l.tapTargets.total, sm: l.tapTargets.small.length, txt: l.text.smallChars + '/' + l.text.totalChars}))));
  console.log('  top', r.findings.slice(0, 6).map(f => `${f.gain} ${f.title}`).join('\n   '));
  console.log('  warnings', r.warnings);
  writeFileSync(`${process.env.TEMP}/sfa-${name}.json`, JSON.stringify(r));
  await site.close();
}
