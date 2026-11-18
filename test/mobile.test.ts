import { describe, expect, it } from 'vitest';
import { analyzeMobile } from '../src/analyzers/mobile.ts';
import type { AreaResult } from '../src/types.ts';
import { fixture, layout, makeEvidence } from './support/evidence.ts';

const byId = (r: AreaResult, id: string) => r.checks.find((c) => c.id === id);

describe('analyzeMobile', () => {
  it('passes a responsive page', () => {
    const r = analyzeMobile(makeEvidence());
    expect(r.checks.map((c) => [c.id, c.status])).toEqual([
      ['mobile.viewport', 'pass'],
      ['mobile.overflow-phone', 'pass'],
      ['mobile.overflow-tablet', 'pass'],
      ['mobile.tap-targets', 'pass'],
      ['mobile.text-size', 'pass'],
    ]);
  });

  it('fails a page without a viewport tag', () => {
    const r = analyzeMobile(makeEvidence({ html: fixture('bad-restaurant.html') }));
    expect(byId(r, 'mobile.viewport')?.score).toBe(0);
    expect(r.findings.find((f) => f.checkId === 'mobile.viewport')?.severity).toBe('critical');
  });

  it('gives partial credit when zooming is disabled', () => {
    const html =
      '<html><head><meta name="viewport" content="width=device-width, user-scalable=no"></head></html>';
    const r = analyzeMobile(makeEvidence({ html }));
    expect(byId(r, 'mobile.viewport')?.status).toBe('warn');
  });

  it('detects sideways scrolling and names the widest element', () => {
    const r = analyzeMobile(
      makeEvidence({
        layouts: [
          layout(375, {
            scrollWidth: 1200,
            overflowing: [{ selector: 'div.wrapper', width: 1200, height: 900 }],
          }),
          layout(768),
          layout(1280),
        ],
      }),
    );
    expect(byId(r, 'mobile.overflow-phone')?.status).toBe('fail');
    const f = r.findings.find((x) => x.checkId === 'mobile.overflow-phone');
    expect(f?.title).toBe('On phones, people have to scroll sideways to read your page');
    expect(f?.fix).toContain('div.wrapper');
  });

  it('scores tap targets by the share that are too small', () => {
    const small = Array.from({ length: 3 }, (_, i) => ({ selector: `a.n${i}`, width: 30, height: 14 }));
    const r = analyzeMobile(
      makeEvidence({ layouts: [layout(375, { tapTargets: { total: 12, small } }), layout(768), layout(1280)] }),
    );
    expect(byId(r, 'mobile.tap-targets')?.score).toBeCloseTo(0.5);
  });

  it('flags tiny text', () => {
    const r = analyzeMobile(
      makeEvidence({
        layouts: [
          layout(375, {
            scale: 0.38,
            text: { totalChars: 1000, smallChars: 900, samples: [{ selector: 'p', width: 300, height: 10, text: 'Call us' }] },
          }),
          layout(768),
          layout(1280),
        ],
      }),
    );
    expect(byId(r, 'mobile.text-size')?.status).toBe('fail');
    expect(r.findings.find((f) => f.checkId === 'mobile.text-size')?.title).toMatch(/90%/);
  });

  it('skips layout checks when the browser could not measure', () => {
    const r = analyzeMobile(makeEvidence({ layouts: [] }));
    expect(byId(r, 'mobile.overflow-phone')?.status).toBe('skip');
    expect(byId(r, 'mobile.viewport')?.status).toBe('pass');
  });
});
