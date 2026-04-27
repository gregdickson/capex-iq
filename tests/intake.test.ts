import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCSV, filterContacts, dedupByDomain } from '../src/pipeline/intake.js';
import { normaliseDomain } from '../src/utils/domain.js';
import { seniorityRank } from '../src/utils/seniority.js';

describe('normaliseDomain', () => {
  it('strips protocol and www', () => {
    expect(normaliseDomain('http://www.aplacelikehome.co.uk')).toBe('aplacelikehome.co.uk');
  });

  it('strips trailing path', () => {
    expect(normaliseDomain('https://example.com/about')).toBe('example.com');
  });

  it('lowercases', () => {
    expect(normaliseDomain('HTTP://WWW.Example.COM')).toBe('example.com');
  });

  it('handles null/undefined', () => {
    expect(normaliseDomain(null)).toBe('');
    expect(normaliseDomain(undefined)).toBe('');
  });
});

describe('seniorityRank', () => {
  it('ranks founder highest', () => {
    expect(seniorityRank('founder', '')).toBe(1);
  });

  it('ranks c_suite second', () => {
    expect(seniorityRank('c_suite', '')).toBe(2);
  });

  it('falls back to title when seniority is empty', () => {
    expect(seniorityRank('', 'Managing Director')).toBe(1);
    expect(seniorityRank('', 'CEO')).toBe(4);
  });

  it('founder beats director', () => {
    expect(seniorityRank('founder', 'Founder and Director')).toBeLessThan(
      seniorityRank('director', 'Director')
    );
  });
});

describe('dedupByDomain', () => {
  it('keeps the more senior contact per domain', () => {
    const contacts = [
      {
        firstName: 'Junior', lastName: 'Person', fullName: 'Junior Person',
        email: 'junior@example.com', position: 'Manager', seniority: 'manager',
        country: 'United Kingdom', city: '', phone: '', linkedinUrl: '',
        orgName: 'Test Co', orgWebsite: 'http://example.com', orgSize: '10',
        orgCountry: 'United Kingdom', orgCity: '', orgIndustry: '', orgDescription: '',
        domain: 'example.com',
      },
      {
        firstName: 'Senior', lastName: 'Person', fullName: 'Senior Person',
        email: 'senior@example.com', position: 'CEO', seniority: 'founder',
        country: 'United Kingdom', city: '', phone: '', linkedinUrl: '',
        orgName: 'Test Co', orgWebsite: 'http://example.com', orgSize: '10',
        orgCountry: 'United Kingdom', orgCity: '', orgIndustry: '', orgDescription: '',
        domain: 'example.com',
      },
    ];

    const deduped = dedupByDomain(contacts);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].firstName).toBe('Senior');
  });
});
