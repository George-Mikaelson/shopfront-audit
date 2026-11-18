import * as cheerio from 'cheerio';
import type { AreaResult, BusinessInfo, Check, Evidence } from '../types.ts';
import { extractJsonLd, findLocalBusiness, textOf } from './structured-data.ts';
import { FindingList, measure, skipped } from './util.ts';

/** Lower-case, no accents, no punctuation, single spaces. */
export function normalizeText(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const PHONE_RE = /\+?\(?\d[\d\s().-]{5,}\d/g;
const DATE_RE = /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/;

interface PhoneMatch {
  raw: string;
  digits: string;
}

function findPhones(text: string): PhoneMatch[] {
  const out: PhoneMatch[] = [];
  for (const m of text.matchAll(PHONE_RE)) {
    const raw = m[0].trim();
    const digits = raw.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15 || DATE_RE.test(raw)) continue;
    if (!out.some((p) => p.digits === digits)) out.push({ raw, digits });
  }
  return out;
}

/** Digit strings of everything that looks like a phone number. */
export function extractPhones(text: string): string[] {
  return findPhones(text).map((p) => p.digits);
}

/**
 * True when two numbers are the same line, written with or without the
 * international prefix ("+351 21…" vs "21…", "0039 06…" vs "+39 06…") or the
 * national trunk zero ("020…" vs "+44 20…").
 */
export function phonesMatch(a: string, b: string): boolean {
  const variants = (s: string): string[] => {
    const d = s.replace(/\D/g, '').replace(/^00/, '');
    return d.startsWith('0') ? [d, d.slice(1)] : [d];
  };
  for (const x of variants(a)) {
    for (const y of variants(b)) {
      const [short, long] = x.length <= y.length ? [x, y] : [y, x];
      if (short.length >= 7 && long.endsWith(short)) return true;
    }
  }
  return false;
}

const ADDRESS_STOPWORDS = new Set(
  `rua r av avenida avda via viale piazza largo travessa praca praça calle c carrer plaza paseo street st road rd avenue ave lane ln
  boulevard blvd strasse straße str platz weg rue place chemin allee allée de da do das dos di del della la le les el los
  the of and e y n no nº num numero número`.split(/\s+/),
);

/** Address words worth comparing; keeps postcodes like "1200-195" whole. */
function addressTokens(s: string): string[] {
  const flat = s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  const tokens = flat.match(/\p{N}+(?:-\p{N}+)?|\p{L}+/gu) ?? [];
  return [...new Set(tokens.filter((t) => !ADDRESS_STOPWORDS.has(t)))];
}

/** Is the business's name, address and phone the same on the site as in the listing? */
export function analyzeNap(ev: Evidence, business: BusinessInfo | undefined): AreaResult {
  const given = {
    name: business?.name?.trim() ?? '',
    address: business?.address?.trim() ?? '',
    phone: business?.phone?.trim() ?? '',
  };
  if (!given.name && !given.address && !given.phone) {
    return {
      area: 'nap',
      checks: [],
      findings: [],
      skippedReason: 'No name, address or phone was supplied to compare against.',
    };
  }

  const $ = cheerio.load(ev.html);
  const ld = findLocalBusiness(extractJsonLd(ev.html).items);
  const ldName = ld ? (textOf(ld.name) ?? '') : '';
  const ldAddress = ld ? (textOf(ld.address) ?? '') : '';
  const ldPhone = ld ? (textOf(ld.telephone) ?? '') : '';
  const title = $('title').first().text();
  const telLinks = $('a[href^="tel:" i]')
    .map((_, el) => ($(el).attr('href') ?? '').slice(4))
    .get();

  const haystack = [ev.text, title, ldName, ldAddress, ldPhone].join('\n');
  const findings = new FindingList('nap');
  const checks: Check[] = [];
  const source = business?.source ? ` (${business.source})` : '';

  // Name
  if (!given.name) {
    checks.push(skipped('nap.name', 'Business name matches', 1, 'No name supplied.'));
  } else {
    const site = normalizeText(haystack);
    const want = normalizeText(given.name);
    const words = want.split(' ').filter((w) => w.length >= 3);
    const found = words.filter((w) => site.split(' ').includes(w)).length;
    const score = site.includes(want) ? 1 : words.length > 0 && found / words.length >= 0.6 ? 0.6 : 0;
    const c = measure(
      'nap.name',
      'Business name matches',
      1,
      score,
      score === 1
        ? `“${given.name}” appears on the page.`
        : score > 0
          ? `Only part of “${given.name}” appears on the page.`
          : `“${given.name}” does not appear on the page.`,
    );
    checks.push(c);
    findings.add(c, {
      title: `Your business name “${given.name}” is not clearly on your home page`,
      explanation: 'Google matches your website to your Maps listing by name. If they differ, it may not link them.',
      fix: `Show the name exactly as on your listing${source} in the page title and header.`,
      severity: 'medium',
      effort: 'quick',
    });
  }

  // Address
  if (!given.address) {
    checks.push(skipped('nap.address', 'Address matches', 2, 'No address supplied.'));
  } else {
    const want = addressTokens(given.address);
    const site = new Set(addressTokens(haystack));
    const found = want.filter((t) => site.has(t));
    const ratio = want.length === 0 ? 1 : found.length / want.length;
    const c = measure(
      'nap.address',
      'Address matches',
      2,
      ratio >= 0.8 ? 1 : ratio >= 0.5 ? 0.5 : 0,
      ratio >= 0.8
        ? 'The address on the site matches the listing.'
        : `${found.length} of ${want.length} address parts were found on the page.`,
    );
    checks.push(c);
    const missing = want.filter((t) => !site.has(t));
    findings.add(c, {
      title: ratio === 0 ? 'Your address is not on your home page' : 'Your address on the site is incomplete or different',
      explanation: `Your listing says “${given.address}”${missing.length > 0 && ratio > 0 ? ` but the site is missing “${missing.join(' ')}”` : ''}. Customers and Google need the same address everywhere.`,
      fix: 'Show the full address (street, number, postcode, town) in the footer of every page, written the same way as on Google Maps.',
      severity: 'medium',
      effort: 'quick',
    });
  }

  // Phone
  const phonesOnSite = findPhones([ev.text, ldPhone, ...telLinks].join('\n'));
  if (!given.phone) {
    checks.push(skipped('nap.phone', 'Phone number matches', 2, 'No phone supplied.'));
  } else {
    const match = phonesOnSite.find((p) => phonesMatch(p.digits, given.phone));
    const other = phonesOnSite[0];
    const c = measure(
      'nap.phone',
      'Phone number matches',
      2,
      match ? 1 : 0,
      match
        ? `${given.phone} appears on the page.`
        : other
          ? `The page shows ${other.raw}, not ${given.phone}.`
          : 'No phone number was found on the page.',
    );
    checks.push(c);
    findings.add(
      c,
      other
        ? {
            title: `Your site shows a different phone number (${other.raw})`,
            explanation: `Your listing${source} says ${given.phone}. Customers who call the wrong one cannot book, and Google trusts listings less when details disagree.`,
            fix: 'Use one phone number everywhere: website, Google Business Profile, Facebook and OpenStreetMap.',
            severity: 'high',
            effort: 'quick',
          }
        : {
            title: 'Your phone number is not on your home page',
            explanation: 'Many people visit a local business site just to call. If they cannot find the number in seconds, they call someone else.',
            fix: `Put ${given.phone} at the top of the page as a tap-to-call link.`,
            severity: 'high',
            effort: 'quick',
          },
    );
  }

  // Tap to call
  if (phonesOnSite.length === 0 && telLinks.length === 0) {
    checks.push(skipped('nap.tap-to-call', 'Phone number can be tapped to call', 1, 'No phone number shown.'));
  } else {
    const c = measure(
      'nap.tap-to-call',
      'Phone number can be tapped to call',
      1,
      telLinks.length > 0 ? 1 : 0,
      telLinks.length > 0 ? 'The phone number is a tap-to-call link.' : 'The phone number is plain text.',
    );
    checks.push(c);
    findings.add(c, {
      title: 'People can’t tap your phone number to call',
      explanation: 'On a phone they have to copy the number by hand or remember it.',
      fix: `Make it a link: <a href="tel:${(given.phone || (phonesOnSite[0]?.raw ?? '')).replace(/[^\d+]/g, '')}">…</a>.`,
      severity: 'medium',
      effort: 'quick',
    });
  }

  return { area: 'nap', checks, findings: findings.items };
}
