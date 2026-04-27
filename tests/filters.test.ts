import { describe, it, expect } from 'vitest';
import { isUK, isSME, isChainExcluded, hasEmail, applyFilters } from '../src/utils/filters.js';

describe('isUK', () => {
  it('accepts United Kingdom', () => {
    expect(isUK('United Kingdom', null)).toBe(true);
  });

  it('accepts UK', () => {
    expect(isUK('UK', null)).toBe(true);
  });

  it('falls back to orgCountry when country is empty', () => {
    expect(isUK('', 'United Kingdom')).toBe(true);
  });

  it('rejects non-UK countries', () => {
    expect(isUK('United States', 'United States')).toBe(false);
  });

  it('accepts UK contact at US org', () => {
    expect(isUK('United Kingdom', 'United States')).toBe(true);
  });
});

describe('isSME', () => {
  it('accepts small companies', () => {
    expect(isSME('4')).toBe(true);
    expect(isSME('59')).toBe(true);
    expect(isSME('500')).toBe(true);
  });

  it('rejects large companies', () => {
    expect(isSME('29962')).toBe(false);
    expect(isSME('520')).toBe(false);
  });

  it('accepts null/empty (no size info)', () => {
    expect(isSME(null)).toBe(true);
    expect(isSME('')).toBe(true);
  });

  it('handles range strings', () => {
    expect(isSME('501 - 1000')).toBe(false);
    expect(isSME('11 - 50')).toBe(true);
  });
});

describe('isChainExcluded', () => {
  it('catches Marriott', () => {
    expect(isChainExcluded('Marriott International')).toBe(true);
  });

  it('catches Cargill', () => {
    expect(isChainExcluded('Cargill')).toBe(true);
  });

  it('catches Wetherspoon', () => {
    expect(isChainExcluded('JD Wetherspoon')).toBe(true);
  });

  it('passes non-chain companies', () => {
    expect(isChainExcluded('A Place Like Home')).toBe(false);
    expect(isChainExcluded('Hotel Felix')).toBe(false);
  });

  it('handles null', () => {
    expect(isChainExcluded(null)).toBe(false);
  });
});

describe('hasEmail', () => {
  it('accepts valid email', () => {
    expect(hasEmail('test@example.com')).toBe(true);
  });

  it('rejects empty/null', () => {
    expect(hasEmail('')).toBe(false);
    expect(hasEmail(null)).toBe(false);
  });
});

describe('applyFilters', () => {
  it('passes a valid UK SME contact', () => {
    expect(applyFilters({
      country: 'United Kingdom',
      orgSize: '4',
      orgName: 'A Place Like Home',
      email: 'silvia@aplacelikehome.co.uk',
      domain: 'aplacelikehome.co.uk',
    }).passed).toBe(true);
  });

  it('rejects chain company', () => {
    const result = applyFilters({
      country: 'United Kingdom',
      orgSize: '29962',
      orgName: 'Marriott International',
      email: 'laura@marriott.com',
      domain: 'marriott.com',
    });
    expect(result.passed).toBe(false);
    // Could fail on not_sme or chain_excluded — both valid
    expect(['not_sme', 'chain_excluded']).toContain(result.reason);
  });
});
