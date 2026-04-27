import type { Job } from 'bullmq';
import { matchCompany } from '../../pipeline/matching.js';
import { updateCompanyStatus, updatePipelineRunCounts } from '../../db/queries.js';
import { getQueue, QUEUE_NAMES } from '../setup.js';

export interface MatchingJobData {
  companyId: number;
  runId: number;
  domain: string;
  orgName: string;
  orgDescription: string;
}

export async function handleMatching(
  job: Job<MatchingJobData>,
  env: { SERPAPI_KEY: string; COMPANIES_HOUSE_API_KEY: string; OPENROUTER_API_KEY: string }
): Promise<void> {
  const { companyId, runId, domain, orgName } = job.data;

  try {
    await updateCompanyStatus(companyId, 'matching');

    const result = await matchCompany(domain, orgName, env);

    if (result.matched) {
      await updateCompanyStatus(companyId, 'matched', {
        company_number: result.companyNumber,
        company_name: result.companyName,
        match_source: result.matchSource,
        matched_at: new Date().toISOString(),
      });

      // Enqueue qualification
      const qualQueue = getQueue(QUEUE_NAMES.QUALIFICATION);
      await qualQueue.add('qualify', {
        companyId,
        runId,
        companyNumber: result.companyNumber,
        companyName: result.companyName,
        orgName,
        orgDescription: job.data.orgDescription,
      }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      });
    } else {
      await updateCompanyStatus(companyId, 'no_match');
    }

    await updatePipelineRunCounts(runId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateCompanyStatus(companyId, 'failed_matching', {
      error_log: JSON.stringify({
        message,
        stage: 'matching',
        timestamp: new Date().toISOString(),
        attempt: job.attemptsMade + 1,
      }),
    });
    await updatePipelineRunCounts(runId);
    throw err; // Re-throw for BullMQ retry
  }
}
