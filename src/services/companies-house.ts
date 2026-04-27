interface CHSearchResult {
  companyNumber: string;
  companyName: string;
}

interface CHApiResponse {
  items?: {
    company_number?: string;
    title?: string;
    company_status?: string;
  }[];
}

export async function searchCompany(
  name: string,
  apiKey: string
): Promise<CHSearchResult | null> {
  const url = `https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(name)}&items_per_page=5`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${Buffer.from(apiKey + ':').toString('base64')}`,
    },
  });

  if (!response.ok) {
    console.error(`[companies-house] Search failed: ${response.status} ${response.statusText}`);
    return null;
  }

  const data = (await response.json()) as CHApiResponse;
  const items = data.items || [];

  // Prefer active companies
  const active = items.find((i) => i.company_status === 'active');
  const best = active || items[0];

  if (!best?.company_number) return null;

  return {
    companyNumber: best.company_number,
    companyName: best.title || name,
  };
}
