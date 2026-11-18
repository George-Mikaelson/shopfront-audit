import { describe, expect, it } from 'vitest';
import { analyzeNap, extractPhones, normalizeText, phonesMatch } from '../src/analyzers/nap.ts';
import type { AreaResult } from '../src/types.ts';
import { fixture, makeEvidence } from './support/evidence.ts';

const byId = (r: AreaResult, id: string) => r.checks.find((c) => c.id === id);

describe('phone helpers', () => {
  it('extracts phone-like numbers from text and ignores short numbers and dates', () => {
    expect(extractPhones('Call +351 21 234 5678 or (21) 999-0000. Open 12:00-23:00, since 2019.')).toEqual([
      '351212345678',
      '219990000',
    ]);
  });

  it('matches numbers with and without the country prefix', () => {
    expect(phonesMatch('+351 21 234 5678', '212345678')).toBe(true);
    expect(phonesMatch('0039 06 1234567', '+39 06 123 4567')).toBe(true);
    expect(phonesMatch('+351 21 234 5678', '21 999 0000')).toBe(false);
  });
});

describe('normalizeText', () => {
  it('lower-cases, strips accents and punctuation', () => {
    expect(normalizeText('Pão & Café, Lda.')).toBe('pao and cafe lda');
  });
});

describe('analyzeNap', () => {
  const business = { name: 'Bistro Verde', address: 'Rua das Flores 12, 1200-195 Lisboa', phone: '+351 21 234 5678' };

  it('is skipped without business details', () => {
    const r = analyzeNap(makeEvidence(), undefined);
    expect(r.skippedReason).toBeDefined();
  });

  it('passes when the site matches the listing', () => {
    const r = analyzeNap(makeEvidence(), business);
    expect(r.checks.map((c) => [c.id, c.status])).toEqual([
      ['nap.name', 'pass'],
      ['nap.address', 'pass'],
      ['nap.phone', 'pass'],
      ['nap.tap-to-call', 'pass'],
    ]);
  });

  it('reports a different phone number in words a shop owner understands', () => {
    const r = analyzeNap(
      makeEvidence({ html: fixture('bad-restaurant.html'), text: 'Welcome\nOur food\nCall us: 21 999 0000\nMENU' }),
      business,
    );
    expect(byId(r, 'nap.phone')?.status).toBe('fail');
    const f = r.findings.find((x) => x.checkId === 'nap.phone');
    expect(f?.title).toBe('Your site shows a different phone number (21 999 0000)');
    expect(f?.explanation).toContain('+351 21 234 5678');
  });

  it('notices a phone number that cannot be tapped', () => {
    const r = analyzeNap(
      makeEvidence({ html: fixture('bad-restaurant.html'), text: 'Call us: +351 21 234 5678' }),
      business,
    );
    expect(byId(r, 'nap.phone')?.status).toBe('pass');
    expect(byId(r, 'nap.tap-to-call')?.status).toBe('fail');
  });

  it('gives partial credit to a partly matching address', () => {
    const r = analyzeNap(
      makeEvidence({ html: '<html><body></body></html>', text: 'Bistro Verde, Rua das Flores, Lisboa' }),
      business,
    );
    expect(byId(r, 'nap.address')?.status).toBe('warn');
  });

  it('fails a missing business name', () => {
    const r = analyzeNap(makeEvidence({ html: '<html><title>Home</title></html>', text: 'Welcome' }), business);
    expect(byId(r, 'nap.name')?.status).toBe('fail');
    expect(byId(r, 'nap.phone')?.detail).toMatch(/no phone number/i);
  });

  it('only checks the fields it was given', () => {
    const r = analyzeNap(makeEvidence(), { name: 'Bistro Verde' });
    expect(byId(r, 'nap.address')?.status).toBe('skip');
    expect(byId(r, 'nap.phone')?.status).toBe('skip');
  });
});
