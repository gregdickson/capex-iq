import type { Job } from 'bullmq';
import { parseCSV, filterContacts, dedupByDomain } from '../../pipeline/intake.js';
import { getQueue, QUEUE_NAMES } from '../setup.js';
import {
  createPipelineRun,
  insertProcessedCompany,
  updatePipelineRunCounts,
  checkDomainProcessed,
} from '../../db/queries.js';
import { getSettingNumber } from '../../db/settings.js';

export interface IntakeJobData {
  csvBuffer: string; // base64 encoded
  filename: string;
}

export async function handleIntake(job: Job<IntakeJobData>): Promise<{ runId: number; processed: number }> {
  const { csvBuffer, filename } = job.data;
  const buffer = Buffer.from(csvBuffer, 'base64');

  // Parse CSV
  const allContacts = parseCSV(buffer);
  console.log(`[intake] Parsed ${allContacts.length} records from ${filename}`);

  // Create pipeline run
  const runId = await createPipelineRun(filename, allContacts.length);

  // Filter contacts
  const { passed, filtered } = filterContacts(allContacts);
  console.log(`[intake] After filters: ${passed.length} passed, ${filtered.length} filtered`);

  // Insert filtered records (for tracking)
  for (const f of filtered) {
    await insertProcessedCompany({
      pipeline_run_id: runId,
      domain: f.contact.domain || `no-domain-${f.contact.email}`,
      status: 'filtered',
      contact_email: f.contact.email,
      contact_first_name: f.contact.firstName,
      contact_last_name: f.contact.lastName,
      contact_full_name: f.contact.fullName,
      contact_position: f.contact.position,
      contact_seniority: f.contact.seniority,
      contact_linkedin: f.contact.linkedinUrl,
      org_name: f.contact.orgName,
      org_size: f.contact.orgSize,
      org_city: f.contact.orgCity,
      org_country: f.contact.orgCountry,
      org_industry: f.contact.orgIndustry,
    });
  }

  // Dedup by domain
  const deduped = dedupByDomain(passed);
  console.log(`[intake] After dedup: ${deduped.length} unique domains`);

  // Check reprocess window and enqueue matching jobs
  const windowDays = await getSettingNumber('reprocess_window_days', 90);
  const matchingQueue = getQueue(QUEUE_NAMES.MATCHING);
  let enqueued = 0;

  for (const contact of deduped) {
    const alreadyProcessed = await checkDomainProcessed(contact.domain, windowDays);

    if (alreadyProcessed) {
      await insertProcessedCompany({
        pipeline_run_id: runId,
        domain: contact.domain,
        status: 'duplicate',
        contact_email: contact.email,
        contact_first_name: contact.firstName,
        contact_last_name: contact.lastName,
        contact_full_name: contact.fullName,
        contact_position: contact.position,
        contact_seniority: contact.seniority,
        contact_linkedin: contact.linkedinUrl,
        org_name: contact.orgName,
        org_size: contact.orgSize,
        org_city: contact.orgCity,
        org_country: contact.orgCountry,
        org_industry: contact.orgIndustry,
      });
      continue;
    }

    // Insert as pending and enqueue matching
    const companyId = await insertProcessedCompany({
      pipeline_run_id: runId,
      domain: contact.domain,
      status: 'pending',
      contact_email: contact.email,
      contact_first_name: contact.firstName,
      contact_last_name: contact.lastName,
      contact_full_name: contact.fullName,
      contact_position: contact.position,
      contact_seniority: contact.seniority,
      contact_linkedin: contact.linkedinUrl,
      org_name: contact.orgName,
      org_size: contact.orgSize,
      org_city: contact.orgCity,
      org_country: contact.orgCountry,
      org_industry: contact.orgIndustry,
    });

    if (companyId) {
      await matchingQueue.add('match', {
        companyId,
        runId,
        domain: contact.domain,
        orgName: contact.orgName,
        orgDescription: contact.orgDescription,
      }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      });
      enqueued++;
    }
  }

  await updatePipelineRunCounts(runId);
  console.log(`[intake] Run #${runId}: ${enqueued} jobs enqueued for matching`);

  return { runId, processed: enqueued };
}
