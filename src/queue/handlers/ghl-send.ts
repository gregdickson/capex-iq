import type { Job } from 'bullmq';
import { createOrUpdateContact, buildGHLFieldIds, type GHLContactData } from '../../services/ghl.js';
import { updateCompanyStatus, updatePipelineRunCounts, getCompanyById } from '../../db/queries.js';

export interface GHLSendJobData {
  companyId: number;
  runId: number;
}

export async function handleGHLSend(
  job: Job<GHLSendJobData>,
  env: Record<string, string>
): Promise<void> {
  const { companyId, runId } = job.data;

  try {
    if (!env.GHL_PRIVATE_TOKEN || !env.GHL_LOCATION_ID) {
      throw new Error('GHL not configured — set GHL_PRIVATE_TOKEN and GHL_LOCATION_ID to enable sending');
    }

    const company = await getCompanyById(companyId);
    if (!company) throw new Error(`Company ${companyId} not found`);

    if (!company.email_sequence) {
      throw new Error(`Company ${companyId} has no email sequence`);
    }

    const emails = typeof company.email_sequence === 'string'
      ? JSON.parse(company.email_sequence)
      : company.email_sequence;

    const contactData: GHLContactData = {
      email: company.contact_email,
      firstName: company.contact_first_name || '',
      lastName: company.contact_last_name || '',
      name: company.contact_full_name || `${company.contact_first_name || ''} ${company.contact_last_name || ''}`.trim(),
      address1: undefined,
      postalCode: undefined,
      website: company.domain,
      source: 'capex_iq_pipeline',
      tags: ['capital-allowance-prospect'],
      emailSequence: emails.map((e: any) => ({
        subject: e.subject,
        preheader: e.preheader,
        body: e.body,
      })),
    };

    const fieldIds = buildGHLFieldIds(env);
    const { contactId } = await createOrUpdateContact(
      contactData,
      env.GHL_PRIVATE_TOKEN,
      env.GHL_LOCATION_ID,
      fieldIds
    );

    await updateCompanyStatus(companyId, 'sent', {
      ghl_contact_id: contactId,
      sent_at: new Date().toISOString(),
    });

    await updatePipelineRunCounts(runId);
    console.log(`[ghl-send] Pushed ${company.contact_email} to GHL (contact: ${contactId})`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateCompanyStatus(companyId, 'failed_ghl_push', {
      error_log: JSON.stringify({
        message,
        stage: 'ghl_send',
        timestamp: new Date().toISOString(),
        attempt: job.attemptsMade + 1,
      }),
    });
    await updatePipelineRunCounts(runId);
    throw err;
  }
}
