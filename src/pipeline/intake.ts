import { parse } from 'csv-parse/sync';
import { normaliseDomain } from '../utils/domain.js';
import { seniorityRank } from '../utils/seniority.js';
import { applyFilters, type FilterReason } from '../utils/filters.js';

export interface Contact {
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  position: string;
  seniority: string;
  country: string;
  city: string;
  phone: string;
  linkedinUrl: string;
  orgName: string;
  orgWebsite: string;
  orgSize: string;
  orgCountry: string;
  orgCity: string;
  orgIndustry: string;
  orgDescription: string;
  domain: string;
}

export interface FilteredContact {
  contact: Contact;
  reason: FilterReason;
}

export function parseCSV(buffer: Buffer): Contact[] {
  const records = parse(buffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  return records.map((r) => {
    // Use firstName/lastName directly; fall back to splitting fullName
    let firstName = (r.firstName || '').trim();
    let lastName = (r.lastName || '').trim();
    const fullName = (r.fullName || r.name || '').trim();

    if (!firstName && !lastName && fullName) {
      const parts = fullName.split(' ');
      firstName = parts[0] || '';
      lastName = parts.slice(1).join(' ');
    }

    const orgWebsite = r.orgWebsite || r.website || '';

    return {
      firstName,
      lastName,
      fullName: fullName || `${firstName} ${lastName}`.trim(),
      email: (r.email || '').trim(),
      position: (r.position || r.title || '').trim(),
      seniority: (r.seniority || '').trim(),
      country: (r.country || '').trim(),
      city: (r.city || '').trim(),
      phone: (r.phone || '').trim(),
      linkedinUrl: (r.linkedinUrl || r.linkedin || '').trim(),
      orgName: (r.orgName || r.companyName || '').trim(),
      orgWebsite,
      orgSize: (r.orgSize || r.employeeCount || '').trim(),
      orgCountry: (r.orgCountry || '').trim(),
      orgCity: (r.orgCity || '').trim(),
      orgIndustry: parseArrayField(r.orgIndustry),
      orgDescription: (r.orgDescription || '').trim(),
      domain: normaliseDomain(orgWebsite),
    };
  });
}

// Apify outputs arrays as strings like "['hospitality']"
function parseArrayField(value: string | undefined): string {
  if (!value) return '';
  // Strip brackets and quotes, return first value
  const cleaned = value.replace(/[\[\]']/g, '').trim();
  return cleaned;
}

export function filterContacts(contacts: Contact[]): {
  passed: Contact[];
  filtered: FilteredContact[];
} {
  const passed: Contact[] = [];
  const filtered: FilteredContact[] = [];

  for (const contact of contacts) {
    const result = applyFilters({
      country: contact.country,
      orgCountry: contact.orgCountry,
      orgSize: contact.orgSize,
      orgName: contact.orgName,
      email: contact.email,
      domain: contact.domain,
    });

    if (result.passed) {
      passed.push(contact);
    } else {
      filtered.push({ contact, reason: result.reason! });
    }
  }

  return { passed, filtered };
}

export function dedupByDomain(contacts: Contact[]): Contact[] {
  const byDomain = new Map<string, Contact>();

  for (const contact of contacts) {
    if (!contact.domain) continue;

    const existing = byDomain.get(contact.domain);
    if (!existing) {
      byDomain.set(contact.domain, contact);
      continue;
    }

    // Keep the contact with better seniority
    const existingRank = seniorityRank(existing.seniority, existing.position);
    const newRank = seniorityRank(contact.seniority, contact.position);

    if (newRank < existingRank) {
      byDomain.set(contact.domain, contact);
    }
  }

  return Array.from(byDomain.values());
}
