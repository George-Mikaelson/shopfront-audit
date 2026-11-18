import { describe, expect, it } from 'vitest';
import { analyzeAccessibility } from '../src/analyzers/accessibility.ts';
import type { AxeViolation } from '../src/types.ts';
import { makeEvidence } from './support/evidence.ts';

const violation = (id: string, impact: AxeViolation['impact'], nodeCount = 1): AxeViolation => ({
  id,
  impact,
  help: `Help for ${id}`,
  description: '',
  helpUrl: `https://dequeuniversity.com/rules/axe/4.14/${id}`,
  nodeCount,
  nodes: [{ target: 'img', html: '<img src="a.png">' }],
});

const withViolations = (...violations: AxeViolation[]) =>
  analyzeAccessibility(
    makeEvidence({ axe: { violations, passes: 30, incomplete: 0, axeVersion: '4.14.1' } }),
  );

describe('analyzeAccessibility', () => {
  it('passes when axe finds nothing', () => {
    const r = withViolations();
    expect(r.checks.every((c) => c.status === 'pass')).toBe(true);
  });

  it('groups violations by impact and fails any critical or serious group', () => {
    const r = withViolations(
      violation('image-alt', 'critical', 12),
      violation('region', 'moderate'),
    );
    const critical = r.checks.find((c) => c.id === 'a11y.critical');
    expect(critical?.status).toBe('fail');
    // burden = 1 + log10(12) ≈ 2.08 -> 1 / 3.08
    expect(critical?.score).toBeCloseTo(0.325, 2);
    expect(r.checks.find((c) => c.id === 'a11y.moderate')?.score).toBeCloseTo(0.5);
  });

  it('writes plain-English findings for well-known rules', () => {
    const r = withViolations(violation('image-alt', 'critical', 12));
    expect(r.findings[0]?.title).toBe('12 images have no text description');
    expect(r.findings[0]?.severity).toBe('critical');
  });

  it('falls back to axe’s own help text for other rules', () => {
    const r = withViolations(violation('scrollable-region-focusable', 'serious', 2));
    expect(r.findings[0]?.title).toBe('Help for scrollable-region-focusable (2 places)');
  });

  it('splits a group’s lost points across its rules by burden', () => {
    const r = withViolations(
      violation('color-contrast', 'serious', 10),
      violation('link-name', 'serious', 1),
    );
    const shares = r.findings.map((f) => f.share);
    expect(shares[0]).toBeCloseTo(2 / 3);
    expect(shares[1]).toBeCloseTo(1 / 3);
  });

  it('skips everything when axe did not run', () => {
    const r = analyzeAccessibility(makeEvidence({ axe: null }));
    expect(r.checks.every((c) => c.status === 'skip')).toBe(true);
  });
});
