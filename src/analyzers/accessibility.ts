import type { AreaResult, AxeViolation, Check, Evidence, Severity } from '../types.ts';
import { FindingList, measure, plural, skipped } from './util.ts';

type Impact = NonNullable<AxeViolation['impact']>;

const GROUPS: { impact: Impact; id: string; title: string; weight: number; severity: Severity }[] = [
  { impact: 'critical', id: 'a11y.critical', title: 'No blocking accessibility problems', weight: 4, severity: 'critical' },
  { impact: 'serious', id: 'a11y.serious', title: 'No serious accessibility problems', weight: 3, severity: 'high' },
  { impact: 'moderate', id: 'a11y.moderate', title: 'No moderate accessibility problems', weight: 2, severity: 'medium' },
  { impact: 'minor', id: 'a11y.minor', title: 'No minor accessibility problems', weight: 1, severity: 'low' },
];

interface Plain {
  title: (n: number) => string;
  explanation: string;
  fix: string;
}

/** Plain-English versions of the axe rules small sites fail most often. */
const PLAIN: Record<string, Plain> = {
  'image-alt': {
    title: (n) => `${plural(n, 'image')} ${n === 1 ? 'has' : 'have'} no text description`,
    explanation: 'Blind visitors using a screen reader hear nothing (or the file name), and Google cannot tell what the photo shows.',
    fix: 'Add a short alt text to each image, e.g. alt="Grilled sea bass with lemon".',
  },
  'color-contrast': {
    title: (n) => `${plural(n, 'piece')} of text ${n === 1 ? 'is' : 'are'} hard to read against the background`,
    explanation: 'Light grey on white, or text over photos, is hard to read on a phone in sunlight and for older visitors.',
    fix: 'Darken the text or lighten the background until the contrast ratio is at least 4.5:1.',
  },
  'link-name': {
    title: (n) => `${plural(n, 'link')} ${n === 1 ? 'has' : 'have'} no readable name`,
    explanation: 'Icon-only links (Instagram, map, phone) are announced as just “link” to screen reader users.',
    fix: 'Give each icon link a label, e.g. aria-label="Instagram".',
  },
  'button-name': {
    title: (n) => `${plural(n, 'button')} ${n === 1 ? 'has' : 'have'} no readable name`,
    explanation: 'Screen reader users hear “button” with no idea what it does.',
    fix: 'Put text inside the button or add an aria-label.',
  },
  'html-has-lang': {
    title: () => 'The page does not say what language it is in',
    explanation: 'Screen readers may read your text with the wrong accent, and translation tools get confused.',
    fix: 'Add the language to the html tag, e.g. <html lang="pt">.',
  },
  'document-title': {
    title: () => 'The page has no title',
    explanation: 'The browser tab and search results show the address instead of your name.',
    fix: 'Add a <title> with your business name and what you do.',
  },
  label: {
    title: (n) => `${plural(n, 'form field')} ${n === 1 ? 'has' : 'have'} no label`,
    explanation: 'People cannot tell what to type in booking or contact forms, and screen readers cannot either.',
    fix: 'Add a visible <label> to every field instead of relying on placeholder text.',
  },
  'meta-viewport': {
    title: () => 'Zooming is disabled',
    explanation: 'People with poor eyesight cannot enlarge the page.',
    fix: 'Remove user-scalable=no and maximum-scale from the viewport tag.',
  },
  'frame-title': {
    title: (n) => `${plural(n, 'embedded map or video', 'embedded maps or videos')} ${n === 1 ? 'has' : 'have'} no title`,
    explanation: 'Screen reader users cannot tell what the embedded frame contains.',
    fix: 'Add a title to each iframe, e.g. title="Map to our shop".',
  },
  'heading-order': {
    title: () => 'Headings skip levels',
    explanation: 'Screen reader users navigate by headings; skipped levels make the page structure confusing.',
    fix: 'Use headings in order: H1, then H2, then H3.',
  },
  'link-in-text-block': {
    title: (n) => `${plural(n, 'link')} can only be told apart by colour`,
    explanation: 'Colour-blind visitors cannot see which words are links.',
    fix: 'Underline links inside paragraphs.',
  },
  list: {
    title: () => 'Some lists are built incorrectly',
    explanation: 'Screen readers cannot announce how many items a list has.',
    fix: 'Only put <li> elements directly inside <ul> or <ol>.',
  },
};

/** Accessibility from axe-core results, grouped by how badly they block people. */
export function analyzeAccessibility(ev: Evidence): AreaResult {
  const findings = new FindingList('accessibility');
  const checks: Check[] = [];
  const axe = ev.axe;

  for (const g of GROUPS) {
    if (!axe) {
      checks.push(skipped(g.id, g.title, g.weight, 'The accessibility scan could not run.'));
      continue;
    }
    const rules = axe.violations.filter((v) => (v.impact ?? 'minor') === g.impact);
    const burdens = rules.map(burden);
    const total = burdens.reduce((a, b) => a + b, 0);
    const nodes = rules.reduce((s, r) => s + r.nodeCount, 0);
    const check = measure(
      g.id,
      g.title,
      g.weight,
      1 / (1 + total),
      rules.length === 0
        ? `No ${g.impact} problems found.`
        : `${plural(rules.length, `${g.impact} problem type`)} in ${plural(nodes, 'place')}.`,
    );
    // Anything that locks people out is a failure, however few elements it hits.
    if (rules.length > 0 && (g.impact === 'critical' || g.impact === 'serious')) check.status = 'fail';
    checks.push(check);

    rules.forEach((rule, i) => {
      const plain = PLAIN[rule.id];
      findings.add(check, {
        key: rule.id,
        share: total > 0 ? (burdens[i] ?? 0) / total : 1,
        title: plain ? plain.title(rule.nodeCount) : `${rule.help} (${plural(rule.nodeCount, 'place')})`,
        explanation: plain?.explanation ?? `${rule.description} More: ${rule.helpUrl}`,
        fix: plain?.fix ?? `See ${rule.helpUrl}`,
        severity: g.severity,
        effort: rule.nodeCount > 20 ? 'moderate' : 'quick',
      });
    });
  }

  return { area: 'accessibility', checks, findings: findings.items };
}

/** One rule counts 1, plus a little more for every tenfold increase in elements hit. */
function burden(v: AxeViolation): number {
  return 1 + Math.log10(Math.max(1, v.nodeCount));
}
