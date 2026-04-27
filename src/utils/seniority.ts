// Seniority ranking from Apify's seniority field
const SENIORITY_RANK: Record<string, number> = {
  founder: 1,
  c_suite: 2,
  director: 3,
  vp: 4,
  manager: 5,
  senior: 6,
  entry: 7,
};

// Title-based ranking as fallback (lower = more senior)
function titlePriority(title: string): number {
  const t = (title || '').toLowerCase();
  if (t.includes('managing director') || t.includes(' md')) return 1;
  if (t.includes('owner') || t.includes('proprietor')) return 2;
  if (t.includes('founder') || t.includes('co-founder')) return 3;
  if (t.includes('chief executive') || t.includes('ceo')) return 4;
  if (t.includes('finance director') || t.includes('cfo')) return 5;
  if (t.includes('director')) return 6;
  return 10;
}

export function seniorityRank(seniority: string | null | undefined, position: string | null | undefined): number {
  // Use Apify's seniority field first
  if (seniority) {
    const rank = SENIORITY_RANK[seniority.toLowerCase()];
    if (rank !== undefined) return rank;
  }
  // Fall back to title-based ranking
  return titlePriority(position || '');
}
