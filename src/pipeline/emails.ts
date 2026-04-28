import { completeJSON } from '../services/openrouter.js';
import { queryKnowledgeBase } from '../services/supabase.js';
import { getActivePrompt } from '../db/prompts.js';
import { getSetting } from '../db/settings.js';
import { type CAAnalysis } from './ai-validation.js';
import { type ScoringResult } from './scoring.js';

export interface EmailSequenceItem {
  email_number: number;
  subject: string;
  preheader: string;
  body: string;
  send_delay_days: number;
  purpose: string;
}

export interface EmailGenerationInput {
  // Contact
  contactFirstName: string;
  contactEmail: string;
  contactPosition: string;
  linkedinUrl: string;
  orgSize: string;
  // Company
  companyName: string;
  companyNumber: string;
  incorporationDate: string | null;
  companyStatus: string | null;
  location: string | null;
  registeredAddress: string | null;
  // Industry
  sicCode: number | string | null;
  sicDescription: string | null;
  orgIndustry: string;
  orgDescription: string;
  // Financials
  totalAssets: number;
  fixedAssets: number;
  previousFixedAssets: number;
  equity: number;
  totalLiabilities: number;
  assetGrowthRate: number;
  netAssetGrowthRate: number;
  // Scoring
  scoring: ScoringResult;
  // CA Analysis (may be null for low-score)
  caAnalysis: CAAnalysis | null;
}

export async function generateEmails(
  input: EmailGenerationInput,
  env: {
    OPENROUTER_API_KEY: string;
    OPENAI_API_KEY: string;
    SUPABASE_URL: string;
    SUPABASE_SERVICE_ROLE_KEY: string;
  }
): Promise<{ emails: EmailSequenceItem[]; promptVersionId: number | null }> {
  const model = await getSetting('model_email_generation') || 'anthropic/claude-sonnet-4-20250514';

  // Query RAG knowledge base for industry context
  const ragQuery = input.sicDescription || input.orgIndustry || 'capital allowances';
  let ragContext = '';

  try {
    const chunks = await queryKnowledgeBase({
      query: ragQuery,
      supabaseUrl: env.SUPABASE_URL,
      supabaseKey: env.SUPABASE_SERVICE_ROLE_KEY,
      openaiKey: env.OPENAI_API_KEY,
      limit: 5,
    });

    if (chunks.length > 0) {
      ragContext = '\n\nRETRIEVED CAPITAL ALLOWANCES KNOWLEDGE:\n' +
        chunks.map((c) => c.content).join('\n---\n');
    }
  } catch (err) {
    console.warn('[emails] RAG query failed, proceeding without knowledge base:', err);
  }

  // Build score band
  const score = input.scoring.capexiqScore;
  const scoreBand = score > 70 ? 'HIGH' : score > 40 ? 'MEDIUM' : 'LOW';

  // Build CA context section
  let caContext = '';
  if (input.caAnalysis) {
    const ca = input.caAnalysis;
    caContext = `
   CA Analysis Available:
   - Recommendation: ${ca.embedded_ca_assessment?.recommendation || 'N/A'}
   - Likely embedded CA range: ${ca.embedded_ca_assessment?.opportunity_estimation?.likely_embedded_ca_range || 'N/A'}
   - Potential tax relief range: ${ca.embedded_ca_assessment?.opportunity_estimation?.potential_tax_relief_range || 'N/A'}
   - Confidence: ${ca.embedded_ca_assessment?.opportunity_estimation?.confidence_level || 'N/A'}
   - Positive indicators: ${ca.detailed_findings?.key_positive_indicators?.join(', ') || 'N/A'}
   - Risk factors: ${ca.detailed_findings?.risk_factors?.join(', ') || 'N/A'}`;
  }

  // Load prompts
  const systemPrompt = await getActivePrompt('email_generation_system');
  const userPromptTemplate = await getActivePrompt('email_generation_user');

  const defaultSystem = `You are a UK capital allowances marketing specialist who writes personalised,
compliant outreach emails. Your emails are concise, professional, and focused
on helping business owners discover embedded capital allowances they may have
missed.

You always use UK English spelling. You never make false claims or guarantee
specific savings without a survey. You do not mention time limits to claim.

NOTE: don't add a sign off or best regards or any sort of information like that. I will add those to the sending document.

# CapEx Check — About the TOOL we're offering

CapEx Check is a free capital allowance eligibility calculator built for accountants. In around two minutes, an accountant can enter a handful of basic details about a client's commercial property and the tool instantly returns an estimated figure for unclaimed capital allowances and the resulting tax saving.

For each email, include a "preheader" field. This is the preview text that appears
after the subject line in email clients (Gmail, Outlook, Apple Mail). Rules:
- 40-100 characters (longer gets truncated)
- Must complement the subject line, not repeat it
- Should add context, intrigue, or a reason to open
- Same tone as the body — professional, warm, not clickbait
- UK English spelling

Return your output as structured JSON matching the required schema exactly.${ragContext}`;

  const defaultUser = `Generate a 5-email outreach drip sequence for a UK capital allowances consultancy targeting the following prospect.

   Prospect Context
   - Contact first name: ${input.contactFirstName}
   - Company: ${input.companyName}
   - Industry: ${input.sicDescription || input.orgIndustry || 'general business'}
   - SIC classification: ${input.sicCode || 'Unknown'}
   - Estimated opportunity value: ${input.scoring.opportunityValue}
   - CapexIQ score band: ${scoreBand} (${score}/100)
   - Location: ${input.location || 'UK'}
   - Key indicators: ${input.scoring.indicators.join(', ')}
   - Total assets: £${(input.totalAssets || 0).toLocaleString()}
   - Fixed assets: £${(input.fixedAssets || 0).toLocaleString()}
   ${caContext}

   Email Sequence Structure
   1. Email 1 — Awareness (Day 0): Introduce capital allowances as an overlooked tax relief. Mention that many UK businesses miss embedded allowances in their commercial property. Keep it short (3-4 sentences) and end with a soft question.
   2. Email 2 — Relevance (Day 3): Connect capital allowances specifically to their industry and financial data. Reference the type of fixtures and plant/machinery typical in their sector. Show you understand their business.
   3. Email 3 — Proof (Day 7): Include a brief anonymised case study or typical numbers for their industry. Build credibility.
   4. Email 4 — Ease (Day 12): Explain how the process works — non-intrusive survey, HMRC-compliant claim, no upfront cost (success-fee basis). Remove friction and objections.
   5. Email 5 — Urgency (Day 18): Final call-to-action. Offer a specific next step (15-minute call or free desk-based assessment via CapEx Check).

   Tone & Style Rules
   - Professional but warm, not pushy or salesy
   - UK English spelling throughout
   - First-name basis with the contact
   - Short paragraphs (2-3 sentences max)
   - Each email should be 80-150 words in the body
   - Subject lines: 5-8 words, no clickbait
   - Do NOT use the word "synergy" or corporate jargon`;

  const result = await completeJSON<Record<string, any>>({
    model,
    systemPrompt: systemPrompt?.content || defaultSystem,
    userPrompt: userPromptTemplate?.content || defaultUser,
    apiKey: env.OPENROUTER_API_KEY,
  });

  // The model may return the array under different keys — find it robustly
  const emails: EmailSequenceItem[] =
    result.email_sequence ||
    result.emails ||
    result.sequence ||
    (Array.isArray(result) ? result : null);

  if (!emails || !Array.isArray(emails) || emails.length === 0) {
    throw new Error(`Model returned unexpected email structure: ${JSON.stringify(Object.keys(result))}`);
  }

  return {
    emails,
    promptVersionId: systemPrompt?.id || null,
  };
}
