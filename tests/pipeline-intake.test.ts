import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCSV, filterContacts, dedupByDomain } from '../src/pipeline/intake.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sampleCSV = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample-contacts.csv'));

describe('Full intake pipeline with sample CSV', () => {
  const contacts = parseCSV(sampleCSV);

  it('parses all 10 rows', () => {
    expect(contacts).toHaveLength(10);
  });

  it('correctly extracts firstName/lastName', () => {
    const silvia = contacts[0];
    expect(silvia.firstName).toBe('Silvia');
    expect(silvia.lastName).toBe('Johnston');
  });

  it('normalises domains', () => {
    const silvia = contacts[0];
    expect(silvia.domain).toBe('aplacelikehome.co.uk');
  });

  it('parses orgIndustry from array string', () => {
    const silvia = contacts[0];
    expect(silvia.orgIndustry).toBe('hospitality');
  });

  describe('filtering', () => {
    const { passed, filtered } = filterContacts(contacts);

    it('filters Marriott (chain exclusion)', () => {
      const marriott = filtered.find((f) => f.contact.orgName === 'Marriott International');
      expect(marriott).toBeDefined();
      // Could be filtered for chain_excluded or not_sme
      expect(['chain_excluded', 'not_sme']).toContain(marriott!.reason);
    });

    it('filters Cargill (chain + too large)', () => {
      const cargill = filtered.find((f) => f.contact.orgName === 'Cargill');
      expect(cargill).toBeDefined();
    });

    it('filters contact with no email', () => {
      const noEmail = filtered.find((f) => f.contact.firstName === 'Steve' && f.contact.orgName === 'Flight Club Darts');
      expect(noEmail).toBeDefined();
      expect(noEmail!.reason).toBe('no_email');
    });

    it('filters non-UK contact (US country)', () => {
      const usContact = filtered.find((f) => f.contact.firstName === 'John');
      expect(usContact).toBeDefined();
      expect(usContact!.reason).toBe('not_uk');
    });

    it('filters Village Hotels (>500 employees)', () => {
      const village = filtered.find((f) => f.contact.orgName === 'Village Hotels');
      expect(village).toBeDefined();
      expect(village!.reason).toBe('not_sme');
    });

    it('passes A Place Like Home', () => {
      const aplh = passed.find((c) => c.domain === 'aplacelikehome.co.uk');
      expect(aplh).toBeDefined();
    });

    it('passes Magnuson Worldwide (UK contact, US org HQ)', () => {
      const magnuson = passed.find((c) => c.domain === 'magnusonworldwide.com');
      expect(magnuson).toBeDefined();
    });

    it('passes Whoosh Ltd', () => {
      const whoosh = passed.find((c) => c.domain === 'eatwhoosh.com');
      expect(whoosh).toBeDefined();
    });
  });

  describe('dedup', () => {
    const { passed } = filterContacts(contacts);
    const deduped = dedupByDomain(passed);

    it('deduplicates A Place Like Home (keeps founder over entry)', () => {
      const aplhContacts = passed.filter((c) => c.domain === 'aplacelikehome.co.uk');
      expect(aplhContacts.length).toBeGreaterThanOrEqual(2); // Silvia (founder) + Junior (entry)

      const deduped_aplh = deduped.filter((c) => c.domain === 'aplacelikehome.co.uk');
      expect(deduped_aplh).toHaveLength(1);
      expect(deduped_aplh[0].firstName).toBe('Silvia'); // Founder beats entry
    });
  });
});
