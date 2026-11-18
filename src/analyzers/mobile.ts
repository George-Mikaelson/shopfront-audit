import * as cheerio from 'cheerio';
import type { AreaResult, Check, Evidence, ViewportLayout } from '../types.ts';
import { FindingList, measure, plural, skipped } from './util.ts';

/** Minimum target size from WCAG 2.2 (2.5.8). Google recommends 48 px. */
export const MIN_TAP_PX = 24;
/** Text smaller than this (after the phone's zoom) is hard to read. */
export const MIN_TEXT_PX = 12;

/** Does the site work on a phone? Measured at 375, 768 and 1280 px. */
export function analyzeMobile(ev: Evidence): AreaResult {
  const findings = new FindingList('mobile');
  const checks: Check[] = [];
  const $ = cheerio.load(ev.html);

  const viewport = ($('meta[name="viewport" i]').attr('content') ?? '').toLowerCase();
  const hasDeviceWidth = /width\s*=\s*device-width/.test(viewport);
  const maxScale = /maximum-scale\s*=\s*([\d.]+)/.exec(viewport)?.[1];
  const zoomBlocked = /user-scalable\s*=\s*(no|0)/.test(viewport) || (maxScale !== undefined && Number(maxScale) < 2);
  const vpScore = !hasDeviceWidth ? 0 : zoomBlocked ? 0.6 : 1;
  const vp = measure(
    'mobile.viewport',
    'Page is set up for phone screens',
    3,
    vpScore,
    !viewport
      ? 'There is no viewport tag, so phones show a shrunken desktop page.'
      : !hasDeviceWidth
        ? `The viewport tag (“${viewport}”) does not use the device width.`
        : zoomBlocked
          ? 'The page blocks pinch-to-zoom.'
          : 'The viewport tag is correct.',
  );
  checks.push(vp);
  findings.add(
    vp,
    vpScore === 0
      ? {
          title: 'On phones, your site shows a tiny desktop page',
          explanation:
            'The page is not set up for small screens, so phones shrink the whole desktop layout. Visitors have to pinch and zoom to read anything.',
          fix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> and make the layout responsive.',
          severity: 'critical',
          effort: 'major',
        }
      : {
          title: 'Your site stops people from zooming in',
          explanation: 'People with poor eyesight cannot enlarge the text or photos.',
          fix: 'Remove “user-scalable=no” and “maximum-scale” from the viewport tag.',
          severity: 'medium',
          effort: 'quick',
        },
  );

  const phone = ev.layouts.find((l) => l.width === 375) ?? ev.layouts[0];
  const tablet = ev.layouts.find((l) => l.width === 768);
  const unmeasured = 'The page could not be measured in a browser.';

  if (!phone) {
    checks.push(skipped('mobile.overflow-phone', 'Fits a phone screen without sideways scrolling', 3, unmeasured));
  } else {
    const c = overflowCheck('mobile.overflow-phone', 'Fits a phone screen without sideways scrolling', 3, phone);
    checks.push(c);
    findings.add(c, {
      title: 'On phones, people have to scroll sideways to read your page',
      explanation: `The page is ${phone.scrollWidth} px wide but the screen only shows ${phone.layoutWidth} px, so text and buttons are cut off.`,
      fix: `Make wide elements shrink to the screen width (max-width: 100%)${culprits(phone)}.`,
      severity: 'high',
      effort: 'moderate',
    });
  }

  if (!tablet) {
    checks.push(skipped('mobile.overflow-tablet', 'Fits a tablet screen', 1, unmeasured));
  } else {
    const c = overflowCheck('mobile.overflow-tablet', 'Fits a tablet screen', 1, tablet);
    checks.push(c);
    findings.add(c, {
      title: 'On tablets, part of your page is cut off',
      explanation: `At ${tablet.width} px the page needs ${tablet.scrollWidth} px, so visitors scroll sideways.`,
      fix: `Check the layout at tablet width${culprits(tablet)}.`,
      severity: 'low',
      effort: 'moderate',
    });
  }

  if (!phone || phone.tapTargets.total === 0) {
    checks.push(skipped('mobile.tap-targets', 'Buttons and links are big enough to tap', 2, phone ? 'No links or buttons found.' : unmeasured));
  } else {
    const { total, small } = phone.tapTargets;
    const ratio = small.length / total;
    const c = measure(
      'mobile.tap-targets',
      'Buttons and links are big enough to tap',
      2,
      1 - Math.min(1, ratio * 2),
      `${small.length} of ${plural(total, 'link or button', 'links and buttons')} are smaller than ${MIN_TAP_PX} px on a phone.`,
    );
    checks.push(c);
    const examples = small
      .slice(0, 3)
      .map((s) => (s.text ? `“${s.text}”` : s.selector))
      .join(', ');
    findings.add(c, {
      title: `${plural(small.length, 'link or button', 'links and buttons')} are too small to tap with a finger`,
      explanation: `People keep hitting the wrong one${examples ? ` (for example ${examples})` : ''}.`,
      fix: 'Make links and buttons at least 44 px tall on phones, with some space between them.',
      severity: ratio > 0.3 ? 'high' : 'medium',
      effort: 'moderate',
    });
  }

  if (!phone || phone.text.totalChars === 0) {
    checks.push(skipped('mobile.text-size', 'Text is readable without zooming', 2, phone ? 'No text found.' : unmeasured));
  } else {
    const ratio = phone.text.smallChars / phone.text.totalChars;
    const pct = Math.round(ratio * 100);
    const c = measure(
      'mobile.text-size',
      'Text is readable without zooming',
      2,
      1 - Math.min(1, ratio * 1.5),
      `${pct}% of the text is smaller than ${MIN_TEXT_PX} px on a phone.`,
    );
    checks.push(c);
    findings.add(c, {
      title: `${pct}% of your text is too small to read on a phone`,
      explanation:
        phone.scale < 0.9
          ? 'Because the phone shrinks the whole page, the text ends up tiny.'
          : 'Small print is hard to read on a phone, especially outdoors.',
      fix: 'Use at least 16 px for body text and make the layout responsive.',
      severity: ratio > 0.5 ? 'high' : 'medium',
      effort: 'moderate',
    });
  }

  return { area: 'mobile', checks, findings: findings.items };
}

function overflowCheck(id: string, title: string, weight: number, l: ViewportLayout): Check {
  const overflow = l.scrollWidth - l.layoutWidth;
  return measure(
    id,
    title,
    weight,
    overflow <= 1 ? 1 : 0,
    overflow <= 1
      ? `At ${l.width} px the page fits the screen.`
      : `At ${l.width} px the page is ${l.scrollWidth} px wide (${overflow} px too wide).`,
  );
}

function culprits(l: ViewportLayout): string {
  const names = l.overflowing.slice(0, 3).map((e) => e.selector);
  return names.length > 0 ? `; the widest elements are ${names.join(', ')}` : '';
}
