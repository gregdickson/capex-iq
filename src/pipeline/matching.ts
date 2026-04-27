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
  console.log(`[matching] Starting match for domain=${domain} orgName=${orgName}`);

  // Step 1: SerpAPI domain search
  let serpResult;
  try {
    serpResult = await searchDomain(domain, env.SERPAPI_KEY);
    const count = serpResult?.organic_results?.length || 0;
    console.log(`[matching] Step 1 (domain search): ${count} results for ${domain}`);
    if (count > 0) {
      const top = serpResult!.organic_results![0];
      console.log(`[matching]   Top result: ${top.title} — ${top.link}`);
    }
  } catch (err) {
    console.error(`[matching] Step 1 FAILED for ${domain}:`, err);
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
      console.log(`[matching] Step 2 (AI mode): ${aiText ? aiText.substring(0, 200) : '(empty)'}`);

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
        console.log(`[matching] Step 3 (LLM extract): "${companyNameExtracted}"`);
      }
    } catch (err) {
      console.error(`[matching] Step 2/3 FAILED for ${domain}:`, err);
    }
  } else {
    console.log(`[matching] Step 2 skipped — no top result from domain search`);
  }

  // Step 4: SerpAPI Companies House search
  if (companyNameExtracted) {
    try {
      const companyNumber = await searchCompaniesHouseSERP(
        companyNameExtracted,
        env.SERPAPI_KEY
      );
      console.log(`[matching] Step 4 (SERP CH search): "${companyNameExtracted}" → ${companyNumber || 'no match'}`);

      if (companyNumber) {
        console.log(`[matching] MATCHED via serpapi_chain: ${companyNameExtracted} (${companyNumber})`);
        return {
          matched: true,
          companyNumber,
          companyName: companyNameExtracted,
          matchSource: 'serpapi_chain',
        };
      }
    } catch (err) {
      console.error(`[matching] Step 4 FAILED for ${companyNameExtracted}:`, err);
    }
  } else {
    console.log(`[matching] Step 4 skipped — no company name extracted`);
  }

  // Step 5: Fallback — Companies House API direct search by orgName
  try {
    const chResult = await searchCompany(orgName, env.COMPANIES_HOUSE_API_KEY);
    console.log(`[matching] Step 5 (CH API fallback): "${orgName}" → ${chResult ? `${chResult.companyName} (${chResult.companyNumber})` : 'no match'}`);
    if (chResult) {
      console.log(`[matching] MATCHED via companies_house_api: ${chResult.companyName} (${chResult.companyNumber})`);
      return {
        matched: true,
        companyNumber: chResult.companyNumber,
        companyName: chResult.companyName,
        matchSource: 'companies_house_api',
      };
    }
  } catch (err) {
    console.error(`[matching] Step 5 FAILED for ${orgName}:`, err);
  }

  console.log(`[matching] NO MATCH for domain=${domain} orgName=${orgName}`);
  return { matched: false };
}
