import type { Job } from 'bullmq';
import { generateEmails, type EmailGenerationInput } from '../../pipeline/emails.js';
import { updateCompanyStatus, updatePipelineRunCounts, getCompanyById } from '../../db/queries.js';
import { getQueue, QUEUE_NAMES } from '../setup.js';
import type { ScoringResult } from '../../pipeline/scoring.js';
import type { CAAnalysis } from '../../pipeline/ai-validation.js';

export interface EmailGenerationJobData {
  companyId: number;
  runId: number;
  companyNumber: string;
  companyName: string;
  orgName: string;
  orgDescription: string;
  scoring: ScoringResult | null;
  caAnalysis: CAAnalysis | null;
  isNoMatch?: boolean;
  incorporationDate: string | null;
  sicCode: number | null;
  sicDescription: string | null;
  location: string | null;
  companyStatus: string | null;
  financials: Record<string, any>;
  extracted: {
    currentPPE: number;
    previousPPE: number;
    totalAssets: number;
    turnoverRevenue: number;
    investmentProperty: number;
    sicCode: number | null;
  };
}

export async function handleEmailGeneration(
  job: Job<EmailGenerationJobData>,
  env: {
    OPENROUTER_API_KEY: string;
    OPENAI_API_KEY: string;
    SUPABASE_URL: string;
    SUPABASE_SERVICE_ROLE_KEY: string;
  }
): Promise<void> {
  const data = job.data;
  const { companyId, runId } = data;

  try {
    await updateCompanyStatus(companyId, 'generating_emails');

    // Get contact info from DB record
    const company = await getCompanyById(companyId);
    if (!company) throw new Error(`Company ${companyId} not found`);

    const input: EmailGenerationInput = {
      contactFirstName: company.contact_first_name || 'there',
      contactEmail: company.contact_email || '',
      contactPosition: company.contact_position || '',
      linkedinUrl: company.contact_linkedin || '',
      orgSize: company.org_size || '',
      companyName: data.companyName,
      companyNumber: data.companyNumber,
      incorporationDate: data.incorporationDate,
      companyStatus: data.companyStatus,
      location: data.location,
      registeredAddress: null,
      sicCode: data.sicCode,
      sicDescription: data.sicDescription,
      orgIndustry: company.org_industry || '',
      orgDescription: data.orgDescription || '',
      totalAssets: data.financials?.cCalculatedTotalAssets || 0,
      fixedAssets: data.financials?.cCalculatedTotalFixedAssets || 0,
      previousFixedAssets: data.financials?.pCalculatedTotalFixedAssets || 0,
      equity: data.financials?.cCalculatedEquity || 0,
      totalLiabilities: data.financials?.cCalculatedTotalLiabilities || 0,
      assetGrowthRate: data.financials?.assetsGrowthRate || 0,
      netAssetGrowthRate: data.financials?.netAssetsGrowthRate || 0,
      scoring: data.scoring,
      caAnalysis: data.caAnalysis,
      isNoMatch: data.isNoMatch || false,
    };

    const { emails, promptVersionId } = await generateEmails(input, env);

    await updateCompanyStatus(companyId, 'ready_to_send', {
      email_sequence: JSON.stringify(emails),
      prompt_version_id: promptVersionId,
      emails_generated_at: new Date().toISOString(),
    });

    await updatePipelineRunCounts(runId);
    console.log(`[email-gen] Generated ${emails.length} emails for ${data.companyName} (company #${companyId})`);

    // Automatically enqueue GHL send
    const ghlQueue = getQueue(QUEUE_NAMES.GHL_SEND);
    await ghlQueue.add('ghl-send', { companyId, runId }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
    console.log(`[email-gen] Enqueued GHL send for company #${companyId}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateCompanyStatus(companyId, 'failed_email_generation', {
      error_log: JSON.stringify({
        message,
        stage: 'email_generation',
        timestamp: new Date().toISOString(),
        attempt: job.attemptsMade + 1,
      }),
    });
    await updatePipelineRunCounts(runId);
    throw err;
  }
}
