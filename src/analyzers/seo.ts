import * as cheerio from 'cheerio';
import { parseRobots } from '../lib/robots.ts';
import type { AreaResult, Check, Evidence } from '../types.ts';
import { extractJsonLd, findLocalBusiness, validateLocalBusiness } from './structured-data.ts';
import { FindingList, measure, plural, shortUrl, skipped } from './util.ts';

const GENERIC_TITLES = new Set([
  'home',
  'homepage',
  'home page',
  'index',
  'untitled',
  'welcome',
  'new page',
  'my site',
  'my website',
  'document',
  'page',
  'website',
]);

/** Local SEO: can Google find, trust and correctly describe the business? */
export function analyzeSeo(ev: Evidence): AreaResult {
  const $ = cheerio.load(ev.html);
  const findings = new FindingList('seo');
  const checks: Check[] = [];
  const push = (c: Check): Check => {
    checks.push(c);
    return c;
  };

  /* --- Security ------------------------------------------------------ */

  const isHttps = ev.finalUrl.startsWith('https:');
  if (ev.isLocal) {
    push(skipped('seo.https', 'Secure connection (HTTPS)', 3, 'Skipped: local test address.'));
    push(
      skipped(
        'seo.http-redirect',
        'Insecure address forwards to HTTPS',
        2,
        'Skipped: local test address.',
      ),
    );
    push(
      skipped('seo.certificate', 'Valid security certificate', 2, 'Skipped: local test address.'),
    );
  } else {
    const https = push(
      measure(
        'seo.https',
        'Secure connection (HTTPS)',
        3,
        isHttps ? 1 : 0,
        isHttps ? 'The site is served over HTTPS.' : 'The site is served over plain HTTP.',
      ),
    );
    findings.add(https, {
      title: 'Browsers mark your site as “Not secure”',
      explanation:
        'Chrome and Safari show a “Not secure” warning next to your address. Many visitors leave, and Google ranks secure sites higher.',
      fix: 'Turn on HTTPS. Most hosts offer a free Let’s Encrypt certificate with one click.',
      severity: 'critical',
      effort: 'quick',
    });

    if (ev.httpUpgrade === null) {
      push(
        skipped(
          'seo.http-redirect',
          'Insecure address forwards to HTTPS',
          2,
          'Could not test the http:// address.',
        ),
      );
    } else {
      const up = push(
        measure(
          'seo.http-redirect',
          'Insecure address forwards to HTTPS',
          2,
          ev.httpUpgrade.upgradesToHttps ? 1 : 0,
          ev.httpUpgrade.upgradesToHttps
            ? 'Typing the address without https:// still lands on the secure site.'
            : 'The http:// address does not forward to the secure version.',
        ),
      );
      if (isHttps) {
        findings.add(up, {
          title: 'Old links open the insecure version of your site',
          explanation:
            'People who type your address or follow old links land on the unprotected version and see a warning.',
          fix: 'Add a permanent (301) redirect from http:// to https:// in your hosting panel.',
          severity: 'medium',
          effort: 'quick',
        });
      }
    }

    if (ev.tls === null) {
      push(
        skipped(
          'seo.certificate',
          'Valid security certificate',
          2,
          'No certificate to check (no HTTPS).',
        ),
      );
    } else if (!ev.tls.valid) {
      const cert = push(
        measure(
          'seo.certificate',
          'Valid security certificate',
          2,
          0,
          `The certificate is not valid (${ev.tls.error ?? 'unknown error'}).`,
        ),
      );
      findings.add(cert, {
        title: 'Your security certificate is broken',
        explanation:
          'Visitors get a full-page “Your connection is not private” warning before they can see anything.',
        fix: 'Renew or reinstall the certificate. Ask your host to enable automatic renewal.',
        severity: 'critical',
        effort: 'quick',
      });
    } else {
      const days = ev.tls.daysRemaining ?? 365;
      const cert = push(
        measure(
          'seo.certificate',
          'Valid security certificate',
          2,
          days >= 14 ? 1 : 0.5,
          `The certificate is valid for another ${plural(days, 'day')}.`,
        ),
      );
      findings.add(cert, {
        title: `Your security certificate expires in ${plural(days, 'day')}`,
        explanation: 'When it expires, visitors will see a full-page security warning.',
        fix: 'Renew it now and turn on automatic renewal.',
        severity: 'high',
        effort: 'quick',
      });
    }
  }

  const hops = Math.max(0, ev.redirects.length - 1);
  const redirects = push(
    measure(
      'seo.redirects',
      'Few redirects before the page loads',
      1,
      hops <= 1 ? 1 : hops === 2 ? 0.5 : 0,
      hops === 0
        ? 'The address loads directly.'
        : `The address goes through ${plural(hops, 'redirect')}.`,
    ),
  );
  findings.add(redirects, {
    title: `Your address bounces through ${plural(hops, 'redirect')} before loading`,
    explanation: 'Each hop adds a wait on mobile networks before anything appears.',
    fix: `Point links and your domain settings straight at ${shortUrl(ev.finalUrl)}.`,
    severity: 'low',
    effort: 'quick',
  });

  /* --- Indexing ------------------------------------------------------ */

  const metaRobots = $('meta[name="robots" i], meta[name="googlebot" i]')
    .map((_, el) => $(el).attr('content') ?? '')
    .get()
    .join(',');
  const headerRobots = ev.headers['x-robots-tag'] ?? '';
  const noindex = /noindex|none/i.test(`${metaRobots},${headerRobots}`);
  const indexable = push(
    measure(
      'seo.indexable',
      'Search engines are allowed to list the page',
      3,
      noindex ? 0 : 1,
      noindex
        ? 'The page tells search engines not to list it (noindex).'
        : 'Nothing blocks search engines from listing the page.',
    ),
  );
  findings.add(indexable, {
    title: 'Your site tells Google not to show it',
    explanation:
      'A “noindex” instruction is left in the page, so it will not appear in Google search at all. This is often left over from when the site was built.',
    fix: 'Remove the noindex robots tag (WordPress: Settings → Reading → untick “Discourage search engines”).',
    severity: 'critical',
    effort: 'quick',
  });

  const robotsBlocked =
    ev.robots.found &&
    ev.robots.body !== undefined &&
    // Parse against the final origin: robots.txt only applies to its own host.
    parseRobots(ev.finalUrl, ev.robots.body).isAllowed(ev.finalUrl, 'Googlebot') === false;
  const robots = push(
    measure(
      'seo.robots',
      'robots.txt is present and allows crawling',
      1,
      robotsBlocked ? 0 : ev.robots.found ? 1 : 0.5,
      robotsBlocked
        ? 'robots.txt blocks search engines from the home page.'
        : ev.robots.found
          ? 'robots.txt is present.'
          : 'There is no robots.txt file.',
    ),
  );
  findings.add(
    robots,
    robotsBlocked
      ? {
          title: 'Your robots.txt blocks Google from your whole site',
          explanation:
            'Search engines are told to stay away, so your pages drop out of search results.',
          fix: 'Change robots.txt to allow crawling (remove “Disallow: /”).',
          severity: 'critical',
          effort: 'quick',
        }
      : {
          title: 'There is no robots.txt file',
          explanation:
            'Not serious on its own, but it is the usual place to tell Google where your sitemap is.',
          fix: 'Add a robots.txt with “User-agent: *”, “Allow: /” and a Sitemap line.',
          severity: 'low',
          effort: 'quick',
        },
  );

  const sitemap = push(
    measure(
      'seo.sitemap',
      'Sitemap for search engines',
      1,
      ev.sitemap.found ? 1 : 0,
      ev.sitemap.found
        ? `A sitemap was found${ev.sitemap.urlCount !== undefined ? ` listing ${plural(ev.sitemap.urlCount, 'page')}` : ''}.`
        : 'No sitemap.xml was found.',
    ),
  );
  findings.add(sitemap, {
    title: 'There is no sitemap for Google',
    explanation:
      'A sitemap helps Google discover all your pages, such as the menu or opening hours.',
    fix: 'Generate a sitemap.xml (most site builders have a setting) and submit it in Google Search Console.',
    severity: 'low',
    effort: 'quick',
  });

  /* --- What appears in search results ------------------------------- */

  const title = $('head > title').first().text().trim();
  const generic = GENERIC_TITLES.has(title.toLowerCase());
  const titleScore = !title ? 0 : generic || title.length < 10 || title.length > 65 ? 0.5 : 1;
  const titleCheck = push(
    measure(
      'seo.title',
      'Descriptive page title',
      2,
      titleScore,
      title ? `The title is “${title}” (${title.length} characters).` : 'The page has no title.',
    ),
  );
  findings.add(titleCheck, {
    title: !title
      ? 'Your home page has no title'
      : generic || title.length < 10
        ? `Your page title is just “${title}”`
        : 'Your page title is too long for Google to show',
    explanation:
      'The title is the blue headline people click in Google. It should say who you are, what you do and where.',
    fix: 'Say who you are, what you sell and where in 30 to 60 characters, e.g. “Bistro Verde, Portuguese restaurant in Lisbon”.',
    severity: !title ? 'high' : 'medium',
    effort: 'quick',
  });

  const description = ($('meta[name="description" i]').attr('content') ?? '').trim();
  const descScore = !description
    ? 0
    : description.length < 50 || description.length > 160
      ? 0.5
      : 1;
  const desc = push(
    measure(
      'seo.description',
      'Search result description',
      2,
      descScore,
      description
        ? `The description is ${description.length} characters long.`
        : 'There is no meta description.',
    ),
  );
  findings.add(desc, {
    title: description
      ? 'Your Google description is the wrong length'
      : 'Google has to guess what to show under your name',
    explanation:
      'Without a description, Google picks random text from the page for your search result, often a cookie notice or menu item.',
    fix: 'Write a 120–155 character description saying what you offer, where, and how to book or order.',
    severity: 'medium',
    effort: 'quick',
  });

  const h1Count = $('h1').length;
  const h1 = push(
    measure(
      'seo.h1',
      'One main heading',
      1,
      h1Count === 1 ? 1 : h1Count > 1 ? 0.7 : 0,
      h1Count === 1
        ? 'The page has one main heading.'
        : `The page has ${plural(h1Count, 'main heading')}.`,
    ),
  );
  findings.add(h1, {
    title: h1Count === 0 ? 'The page has no main heading' : `The page has ${h1Count} main headings`,
    explanation:
      'Search engines and screen readers use the main heading to understand what the page is about.',
    fix: 'Use exactly one H1 heading with your business name and what you do.',
    severity: 'low',
    effort: 'quick',
  });

  const og = ['og:title', 'og:description', 'og:image'];
  const ogMissing = og.filter((p) => !($(`meta[property="${p}"]`).attr('content') ?? '').trim());
  const ogCheck = push(
    measure(
      'seo.open-graph',
      'Link preview for WhatsApp and social media',
      1,
      (og.length - ogMissing.length) / og.length,
      ogMissing.length === 0
        ? 'Open Graph tags are complete.'
        : `Missing: ${ogMissing.join(', ')}.`,
    ),
  );
  findings.add(ogCheck, {
    title: 'Links to your site look bare when shared',
    explanation:
      'When someone sends your link on WhatsApp, Instagram or Facebook, it shows no picture or summary, so fewer people tap it.',
    fix: `Add Open Graph tags (${ogMissing.join(', ')}) with a nice photo of your place.`,
    severity: 'low',
    effort: 'quick',
  });

  /* --- Structured data ---------------------------------------------- */

  const { items, errors } = extractJsonLd(ev.html);
  const business = findLocalBusiness(items);
  const hasMicrodata = $('[itemtype*="schema.org"]').length > 0;
  if (business) {
    const v = validateLocalBusiness(business);
    const reqScore = 1 - v.missingRequired.length / 4;
    const recCount = v.missingRecommended.length;
    const recTotal =
      v.type && /Restaurant|Food|Cafe|Bakery|Bar|Brewery|Winery|IceCream|Distillery/.test(v.type)
        ? 6
        : 4;
    const score = 0.3 + 0.5 * reqScore + 0.2 * (1 - recCount / recTotal);
    const sd = push(
      measure(
        'seo.structured-data',
        'Business details for Google (schema.org)',
        3,
        score,
        v.missingRequired.length === 0 && recCount === 0
          ? `Complete ${v.type} data found.`
          : `${v.type} data found; missing ${[...v.missingRequired, ...v.missingRecommended].join(', ')}.`,
      ),
    );
    findings.add(sd, {
      title: 'Google gets an incomplete description of your business',
      explanation:
        'Your page has business data for Google, but some details are missing, so opening hours or your phone may not show in search and Maps.',
      fix: `Add ${[...v.missingRequired, ...v.missingRecommended].join(', ')} to your ${v.type} structured data.`,
      severity: v.missingRequired.length > 0 ? 'medium' : 'low',
      effort: 'quick',
    });
  } else {
    const broken = errors.length > 0;
    const sd = push(
      measure(
        'seo.structured-data',
        'Business details for Google (schema.org)',
        3,
        hasMicrodata ? 0.5 : 0,
        broken
          ? `Structured data is present but cannot be read (${errors[0] ?? ''}).`
          : hasMicrodata
            ? 'schema.org microdata found (not validated in detail).'
            : 'No LocalBusiness structured data found.',
      ),
    );
    findings.add(sd, {
      title: broken
        ? 'Your business data for Google is broken'
        : 'Google can’t read your opening hours, address or phone',
      explanation: broken
        ? 'The page tries to describe your business to Google, but the code has a typo, so Google ignores all of it.'
        : 'Structured data is a small hidden block that tells Google your address, hours and phone, so they appear directly in search and Maps.',
      fix: broken
        ? 'Fix the JSON-LD block (paste it into validator.schema.org to see the error).'
        : 'Add a schema.org LocalBusiness (or Restaurant, Bakery…) JSON-LD block with name, address, telephone and opening hours.',
      severity: 'medium',
      effort: 'quick',
    });
  }

  /* --- Broken links -------------------------------------------------- */

  if (ev.crawl === null) {
    push(skipped('seo.broken-links', 'No broken links', 2, 'The site was not crawled.'));
  } else {
    const broken = ev.crawl.broken;
    const bl = push(
      measure(
        'seo.broken-links',
        'No broken links',
        2,
        1 - Math.min(1, broken.length / 4),
        `${plural(ev.crawl.linksChecked, 'link')} checked on ${plural(ev.crawl.pagesVisited.length, 'page')}, ${broken.length} broken.`,
      ),
    );
    const sample = broken
      .slice(0, 3)
      .map((b) => shortUrl(b.url, ev.finalUrl))
      .join(', ');
    findings.add(bl, {
      title: `${plural(broken.length, 'link')} on your site lead nowhere`,
      explanation: `Visitors who click them get an error page (${sample}${broken.length > 3 ? '…' : ''}). Google also sees this as a neglected site.`,
      fix: 'Fix or remove these links; the JSON report lists every page they appear on.',
      severity: broken.length >= 3 ? 'high' : 'medium',
      effort: 'quick',
    });
  }

  return { area: 'seo', checks, findings: findings.items };
}
