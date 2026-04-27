import { getJson } from 'serpapi';

interface OrganicResult {
  link?: string;
  title?: string;
  snippet?: string;
}

interface SerpSearchResult {
  organic_results?: OrganicResult[];
}

interface AIModeResult {
  text_blocks?: { snippet?: string }[];
}

export async function searchDomain(domain: string, apiKey: string): Promise<SerpSearchResult> {
  const result = await getJson({
    engine: 'google',
    api_key: apiKey,
    q: `site:${domain} "limited" OR "ltd" OR "llp"`,
    location: 'London, England, United Kingdom',
    gl: 'uk',
  });
  return result as SerpSearchResult;
}

export async function searchAIMode(url: string, snippet: string, apiKey: string): Promise<string> {
  const result = await getJson({
    engine: 'google',
    api_key: apiKey,
    q: `What is the limited name of the company that runs ${url} website?\n${snippet}`,
    location: 'London, England, United Kingdom',
  }) as AIModeResult;

  return result.text_blocks?.[0]?.snippet || '';
}

export async function searchCompaniesHouseSERP(
  companyName: string,
  apiKey: string
): Promise<string | null> {
  const result = await getJson({
    engine: 'google',
    api_key: apiKey,
    q: `${companyName} site:find-and-update.company-information.service.gov.uk`,
    location: 'London, England, United Kingdom',
    google_domain: 'google.co.uk',
    gl: 'uk',
  }) as SerpSearchResult;

  const topResult = result.organic_results?.[0];
  if (!topResult?.link) return null;

  // Extract company number from CH URL pattern
  const match = topResult.link.match(/\/company\/([0-9A-Z]{6,8})/i);
  return match ? match[1] : null;
}
