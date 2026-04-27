import { searchDomain, searchAIMode, searchCompaniesHouseSERP } from '../services/serpapi.js';
import { searchCompany } from '../services/companies-house.js';
import { completeJSON } from '../services/openrouter.js';
import { getSetting } from '../db/settings.js';

export interface MatchResult {
  matched: boolean;
  companyNumber?: string;
  companyName?: string;
  matchSource?: string;
}

export async function matchCompany(
  domain: string,
  orgName: string,
  env: { SERPAPI_KEY: string; COMPANIES_HOUSE_API_KEY: string; OPENROUTER_API_KEY: string }
): Promise<MatchResult> {
  // Step 1: SerpAPI domain search
  let serpResult;
  try {
    serpResult = await searchDomain(domain, env.SERPAPI_KEY);
  } catch (err) {
    console.error(`[matching] SerpAPI domain search failed for ${domain}:`, err);
  }

  const topResult = serpResult?.organic_results?.[0];

  // Step 2: SerpAPI AI Mode — extract limited company name
  let companyNameExtracted: string | null = null;

  if (topResult?.link) {
    try {
      const aiText = await searchAIMode(
        topResult.link,
        topResult.snippet || '',
        env.SERPAPI_KEY
      );

      if (aiText) {
        // Step 3: LLM extraction of company name from AI mode text
        const model = await getSetting('model_entity_extraction') || 'openai/gpt-4o-mini';

        const extracted = await completeJSON<{ limited_company: string }>({
          model,
          systemPrompt: 'Extract the limited company name from the given text. Return JSON.',
          userPrompt: `Output the limited company name in json format from this block of text - "${aiText}"\n\nOutput\n\n{\n"limited_company": \n}`,
          apiKey: env.OPENROUTER_API_KEY,
        });

        companyNameExtracted = extracted.limited_company || null;
      }
    } catch (err) {
      console.error(`[matching] AI mode / LLM extraction failed for ${domain}:`, err);
    }
  }

  // Step 4: SerpAPI Companies House search
  if (companyNameExtracted) {
    try {
      const companyNumber = await searchCompaniesHouseSERP(
        companyNameExtracted,
        env.SERPAPI_KEY
      );

      if (companyNumber) {
        return {
          matched: true,
          companyNumber,
          companyName: companyNameExtracted,
          matchSource: 'serpapi_chain',
        };
      }
    } catch (err) {
      console.error(`[matching] SerpAPI CH search failed for ${companyNameExtracted}:`, err);
    }
  }

  // Step 5: Fallback — Companies House API direct search by orgName
  try {
    const chResult = await searchCompany(orgName, env.COMPANIES_HOUSE_API_KEY);
    if (chResult) {
      return {
        matched: true,
        companyNumber: chResult.companyNumber,
        companyName: chResult.companyName,
        matchSource: 'companies_house_api',
      };
    }
  } catch (err) {
    console.error(`[matching] Companies House API fallback failed for ${orgName}:`, err);
  }

  // No match found
  return { matched: false };
}
