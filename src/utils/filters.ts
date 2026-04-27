// Known large chains to exclude — from n8n WF 1.5
const EXCLUDED_CHAINS = [
  'marriott', 'hilton', 'ihg', 'accor', 'wyndham', 'hyatt',
  'costa', 'starbucks', 'mcdonalds', 'mcdonald', 'burger king', 'kfc',
  'cargill', 'nestle', 'unilever', 'procter', 'mondelez',
  'tesco', 'sainsbury', 'asda', 'morrisons', 'aldi', 'lidl',
  'premier inn', 'travelodge', 'holiday inn',
  'pizza hut', 'dominos', 'subway', 'greggs', 'pret',
  'wagamama', 'nandos', 'zizzi', 'pizza express',
  'whitbread', 'mitchells & butlers', 'greene king',
  'jd wetherspoon', 'wetherspoon',
];

export function isUK(country: string | null | undefined, orgCountry: string | null | undefined): boolean {
  const primary = (country || '').trim();
  const fallback = (orgCountry || '').trim();
  const check = primary || fallback;
  return check === 'United Kingdom' || check === 'UK';
}

export function isSME(orgSize: string | null | undefined): boolean {
  if (!orgSize) return true; // No size info = let it through
  const sizeStr = String(orgSize);

  // Handle range strings like "501 - 1000"
  const match = sizeStr.match(/(\d+)/);
  if (!match) return true;

  const num = parseInt(match[1], 10);
  if (Number.isNaN(num)) return true;

  // If the range starts with 501+ variants, exclude
  if (sizeStr.includes('501') || sizeStr.includes('1001') || sizeStr.includes('5001') || sizeStr.includes('10001')) {
    return false;
  }

  return num <= 500;
}

export function isChainExcluded(orgName: string | null | undefined): boolean {
  if (!orgName) return false;
  const lower = orgName.toLowerCase();
  return EXCLUDED_CHAINS.some((chain) => lower.includes(chain));
}

export function hasEmail(email: string | null | undefined): boolean {
  return Boolean(email && email.trim().length > 0);
}

export type FilterReason = 'not_uk' | 'not_sme' | 'chain_excluded' | 'no_email' | 'no_domain';

export interface FilterResult {
  passed: boolean;
  reason?: FilterReason;
}

export function applyFilters(record: {
  country?: string | null;
  orgCountry?: string | null;
  orgSize?: string | null;
  orgName?: string | null;
  email?: string | null;
  domain?: string;
}): FilterResult {
  if (!isUK(record.country, record.orgCountry)) return { passed: false, reason: 'not_uk' };
  if (!isSME(record.orgSize)) return { passed: false, reason: 'not_sme' };
  if (isChainExcluded(record.orgName)) return { passed: false, reason: 'chain_excluded' };
  if (!hasEmail(record.email)) return { passed: false, reason: 'no_email' };
  if (!record.domain) return { passed: false, reason: 'no_domain' };
  return { passed: true };
}
