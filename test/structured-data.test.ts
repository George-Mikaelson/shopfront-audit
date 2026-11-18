import { describe, expect, it } from 'vitest';
import { extractJsonLd, findLocalBusiness, validateLocalBusiness } from '../src/analyzers/structured-data.ts';
import { fixture } from './support/evidence.ts';

const ld = (json: string) =>
  `<html><head><script type="application/ld+json">${json}</script></head></html>`;

describe('extractJsonLd', () => {
  it('reads every JSON-LD block and flattens @graph and arrays', () => {
    const html =
      ld('{"@graph":[{"@type":"WebSite"},{"@type":"Bakery","name":"Pão"}]}') +
      ld('[{"@type":"Organization"}]');
    const { items, errors } = extractJsonLd(html);
    expect(items.map((i) => i['@type'])).toEqual(['WebSite', 'Bakery', 'Organization']);
    expect(errors).toEqual([]);
  });

  it('reports blocks that are not valid JSON instead of throwing', () => {
    const { items, errors } = extractJsonLd(fixture('bad-restaurant.html'));
    expect(items).toEqual([]);
    expect(errors).toHaveLength(1);
  });
});

describe('findLocalBusiness', () => {
  it('recognises LocalBusiness subtypes, including array @type and schema: prefixes', () => {
    expect(findLocalBusiness([{ '@type': 'WebSite' }, { '@type': ['Thing', 'CafeOrCoffeeShop'] }]))
      .toMatchObject({ '@type': ['Thing', 'CafeOrCoffeeShop'] });
    expect(findLocalBusiness([{ '@type': 'schema:Restaurant' }])).toBeDefined();
    expect(findLocalBusiness([{ '@type': 'http://schema.org/Dentist' }])).toBeDefined();
  });

  it('returns undefined when there is no business entity', () => {
    expect(findLocalBusiness([{ '@type': 'WebPage' }])).toBeUndefined();
  });
});

describe('validateLocalBusiness', () => {
  it('passes a complete restaurant', () => {
    const [item] = extractJsonLd(fixture('good-restaurant.html')).items;
    const result = validateLocalBusiness(item ?? {});
    expect(result.missingRequired).toEqual([]);
    expect(result.missingRecommended).toEqual([]);
  });

  it('lists missing required and recommended properties', () => {
    const result = validateLocalBusiness({ '@type': 'Restaurant', name: 'X', address: 'Main St 1' });
    expect(result.missingRequired).toEqual(['telephone', 'openingHours']);
    expect(result.missingRecommended).toContain('geo');
    expect(result.missingRecommended).toContain('servesCuisine');
  });

  it('accepts openingHoursSpecification in place of openingHours', () => {
    const result = validateLocalBusiness({
      '@type': 'Store',
      name: 'X',
      address: { '@type': 'PostalAddress', streetAddress: 'A 1', addressLocality: 'B' },
      telephone: '1',
      openingHoursSpecification: [{ dayOfWeek: 'Monday', opens: '09:00', closes: '17:00' }],
    });
    expect(result.missingRequired).toEqual([]);
  });

  it('treats an address object without street or town as missing', () => {
    const result = validateLocalBusiness({
      '@type': 'Store',
      name: 'X',
      address: { '@type': 'PostalAddress', addressCountry: 'PT' },
    });
    expect(result.missingRequired).toContain('address');
  });
});
