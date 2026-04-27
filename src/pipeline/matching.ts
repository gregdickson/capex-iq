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
      console.log(`[matching]   Snippet: ${top.snippet?.substring(0, 200) || '(none)'}`);
    }
  } catch (err) {
    console.error(`[matching] Step 1 FAILED for ${domain}:`, err);
  }

  const topResult = serpResult?.organic_results?.[0];
  const allSnippets = serpResult?.organic_results
    ?.map((r) => r.snippet || '')
    .join(' ') || '';

  // Step 1b: Check snippets for company registration number
  const regMatch = allSnippets.match(/(?:company\s*(?:reg(?:istration)?\.?\s*)?(?:no|number|#)?\.?\s*:?\s*)(\d{7,8})/i);
  if (regMatch) {
    const companyNumber = regMatch[1].padStart(8, '0');
    console.log(`[matching] Step 1b (reg number in snippet): found ${companyNumber}`);
    return {
      matched: true,
      companyNumber,
      companyName: orgName,
      matchSource: 'snippet_reg_number',
    };
  }
  console.log(`[matching] Step 1b: no reg number in snippets`);

  // Step 1c: LLM extract Ltd name from snippets
  let companyNameExtracted: string | null = null;

  if (allSnippets.length > 0) {
    try {
      const model = await getSetting('model_entity_extraction') || 'openai/gpt-4o-mini';
      const extracted = await completeJSON<{ limited_company: string }>({
        model,
        systemPrompt: 'Extract the UK limited company name (ending in Ltd, Limited, LLP, or PLC) from the given text. If no limited company name is found, return an empty string. Return JSON.',
        userPrompt: `Extract the limited company name from these search snippets about ${orgName} (${domain}):\n\n"${allSnippets}"\n\nOutput\n\n{\n"limited_company": \n}`,
        apiKey: env.OPENROUTER_API_KEY,
      });
      companyNameExtracted = extracted.limited_company || null;
      console.log(`[matching] Step 1c (LLM from snippets): "${companyNameExtracted}"`);
    } catch (err) {
      console.error(`[matching] Step 1c FAILED:`, err);
    }
  }

  // Step 1c → CH search
  if (companyNameExtracted) {
    try {
      const companyNumber = await searchCompaniesHouseSERP(companyNameExtracted, env.SERPAPI_KEY);
      console.log(`[matching] Step 1c→CH: "${companyNameExtracted}" → ${companyNumber || 'no match'}`);
      if (companyNumber) {
        console.log(`[matching] MATCHED via snippet_llm: ${companyNameExtracted} (${companyNumber})`);
        return {
          matched: true,
          companyNumber,
          companyName: companyNameExtracted,
          matchSource: 'snippet_llm',
        };
      }
    } catch (err) {
      console.error(`[matching] Step 1c→CH FAILED for ${companyNameExtracted}:`, err);
    }
  }

  // Step 1d: SerpAPI AI Mode fallback — if snippet didn't yield a match
  if (topResult?.link && !companyNameExtracted) {
    try {
      const aiText = await searchAIMode(
        topResult.link,
        topResult.snippet || '',
        env.SERPAPI_KEY
      );
      console.log(`[matching] Step 1d (AI mode): ${aiText ? aiText.substring(0, 200) : '(empty)'}`);

      if (aiText) {
        const model = await getSetting('model_entity_extraction') || 'openai/gpt-4o-mini';
        const extracted = await completeJSON<{ limited_company: string }>({
          model,
          systemPrompt: 'Extract the UK limited company name (ending in Ltd, Limited, LLP, or PLC) from the given text. If no limited company name is found, return an empty string. Return JSON.',
          userPrompt: `Output the limited company name in json format from this block of text - "${aiText}"\n\nOutput\n\n{\n"limited_company": \n}`,
          apiKey: env.OPENROUTER_API_KEY,
        });

        companyNameExtracted = extracted.limited_company || null;
        console.log(`[matching] Step 1d (LLM from AI mode): "${companyNameExtracted}"`);

        if (companyNameExtracted) {
          const companyNumber = await searchCompaniesHouseSERP(companyNameExtracted, env.SERPAPI_KEY);
          console.log(`[matching] Step 1d→CH: "${companyNameExtracted}" → ${companyNumber || 'no match'}`);
          if (companyNumber) {
            console.log(`[matching] MATCHED via ai_mode: ${companyNameExtracted} (${companyNumber})`);
            return {
              matched: true,
              companyNumber,
              companyName: companyNameExtracted,
              matchSource: 'ai_mode',
            };
          }
        }
      }
    } catch (err) {
      console.error(`[matching] Step 1d FAILED for ${domain}:`, err);
    }
  } else if (!topResult?.link) {
    console.log(`[matching] Step 1d skipped — no top result from domain search`);
  }

  // Step 2: Fallback — Companies House API direct search by orgName
  try {
    const chResult = await searchCompany(orgName, env.COMPANIES_HOUSE_API_KEY);
    console.log(`[matching] Step 2 (CH API fallback): "${orgName}" → ${chResult ? `${chResult.companyName} (${chResult.companyNumber})` : 'no match'}`);
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
    console.error(`[matching] Step 2 FAILED for ${orgName}:`, err);
  }

  console.log(`[matching] NO MATCH for domain=${domain} orgName=${orgName}`);
  return { matched: false };
}
