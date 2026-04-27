import type { Job } from 'bullmq';
import { qualifyCompany } from '../../pipeline/qualification.js';
import { updateCompanyStatus, updatePipelineRunCounts } from '../../db/queries.js';
import { getQueue, QUEUE_NAMES } from '../setup.js';

export interface QualificationJobData {
  companyId: number;
  runId: number;
  companyNumber: string;
  companyName: string;
  orgName: string;
  orgDescription: string;
}

export async function handleQualification(
  job: Job<QualificationJobData>,
  env: { DATALEDGER_API_KEY: string; OPENROUTER_API_KEY: string }
): Promise<void> {
  const { companyId, runId, companyNumber, orgName, orgDescription } = job.data;

  try {
    await updateCompanyStatus(companyId, 'qualifying');

    const result = await qualifyCompany(companyNumber, orgName, env);

    // Flatten financials for DB storage
    const flatFinancials: Record<string, any> = {};
    if (result.financials) {
      const currentBS = result.financials.financials?.balanceSheet?.currentYear || {};
      const previousBS = result.financials.financials?.balanceSheet?.previousYear || {};
      flatFinancials.cCalculatedTotalAssets = currentBS.calculatedTotalAssets;
      flatFinancials.cCalculatedTotalFixedAssets = currentBS.calculatedTotalFixedAssets;
      flatFinancials.cCalculatedTotalCurrentAssets = currentBS.calculatedTotalCurrentAssets;
      flatFinancials.cCalculatedTotalLiabilities = currentBS.calculatedTotalLiabilities;
      flatFinancials.cCalculatedEquity = currentBS.calculatedEquity;
      flatFinancials.pCalculatedTotalAssets = previousBS.calculatedTotalAssets;
      flatFinancials.pCalculatedTotalFixedAssets = previousBS.calculatedTotalFixedAssets;
      flatFinancials.assetsGrowthRate = result.financials.financials?.assetsGrowthRate;
      flatFinancials.netAssetsGrowthRate = result.financials.financials?.netAssetsGrowthRate;
    }

    await updateCompanyStatus(companyId, 'scored', {
      capexiq_score: result.scoring.capexiqScore,
      ppe_score: result.scoring.ppeScore,
      sic_score: result.scoring.sicScore,
      investment_activity_score: result.scoring.investmentActivityScore,
      asset_intensity_score: result.scoring.assetIntensityScore,
      ppe_category: result.scoring.ppeCategory,
      opportunity_value: result.scoring.opportunityValue,
      ca_indicators: `{${result.scoring.indicators.map((i) => `"${i.replace(/"/g, '\\"')}"`).join(',')}}`,
      financials: JSON.stringify(flatFinancials),
      ca_analysis: result.caAnalysis ? JSON.stringify(result.caAnalysis) : null,
      company_name: result.companyName,
      qualified_at: new Date().toISOString(),
    });

    // Enqueue email generation — all scored companies get emails
    const emailQueue = getQueue(QUEUE_NAMES.EMAIL_GENERATION);
    await emailQueue.add('generate', {
      companyId,
      runId,
      companyNumber: result.companyNumber,
      companyName: result.companyName,
      orgName,
      orgDescription,
      scoring: result.scoring,
      caAnalysis: result.caAnalysis,
      incorporationDate: result.incorporationDate,
      sicCode: result.extracted.sicCode,
      sicDescription: result.sicDescription,
      location: result.location,
      companyStatus: result.companyStatus,
      financials: flatFinancials,
      extracted: result.extracted,
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });

    await updatePipelineRunCounts(runId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateCompanyStatus(companyId, 'failed_qualification', {
      error_log: JSON.stringify({
        message,
        stage: 'qualification',
        timestamp: new Date().toISOString(),
        attempt: job.attemptsMade + 1,
      }),
    });
    await updatePipelineRunCounts(runId);
    throw err;
  }
}
