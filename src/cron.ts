import { loadCronEnv } from './config/env.js';
import { runMigrations } from './db/migrate.js';
import { getSettingNumber, getSetting } from './db/settings.js';
import {
  getReadyToSend,
  getSentTodayCount,
  getRetriableFailures,
  updateCompanyStatus,
} from './db/queries.js';
import { getQueue, QUEUE_NAMES } from './queue/setup.js';
import { sendNotification, buildDailySummary } from './services/webhook.js';
import { query } from './db/client.js';

const env = loadCronEnv();

async function dailyGHLSend() {
  const dailyLimit = await getSettingNumber('daily_send_limit', 150);
  const sentToday = await getSentTodayCount();
  const remaining = Math.max(0, dailyLimit - sentToday);

  if (remaining === 0) {
    console.log(`[cron] Daily send limit reached (${sentToday}/${dailyLimit}). Skipping.`);
    return 0;
  }

  const records = await getReadyToSend(remaining);
  if (records.length === 0) {
    console.log('[cron] No records ready to send.');
    return 0;
  }

  const ghlQueue = getQueue(QUEUE_NAMES.GHL_SEND);
  let enqueued = 0;

  for (const record of records) {
    await ghlQueue.add('ghl-send', {
      companyId: record.id,
      runId: record.pipeline_run_id,
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
    enqueued++;
  }

  console.log(`[cron] Enqueued ${enqueued} GHL sends (${sentToday + enqueued}/${dailyLimit} today)`);
  return enqueued;
}

async function retryFailedJobs() {
  const failures = await getRetriableFailures(3);
  if (failures.length === 0) {
    console.log('[cron] No retriable failures.');
    return 0;
  }

  const statusToQueue: Record<string, string> = {
    failed_matching: QUEUE_NAMES.MATCHING,
    failed_qualification: QUEUE_NAMES.QUALIFICATION,
    failed_email_generation: QUEUE_NAMES.EMAIL_GENERATION,
    failed_ghl_push: QUEUE_NAMES.GHL_SEND,
  };

  let retried = 0;

  for (const record of failures) {
    const queueName = statusToQueue[record.status];
    if (!queueName) continue;

    const queue = getQueue(queueName);
    let jobData: Record<string, any> = {
      companyId: record.id,
      runId: record.pipeline_run_id,
    };

    // Build appropriate job data based on the stage
    if (queueName === QUEUE_NAMES.MATCHING) {
      jobData.domain = record.domain;
      jobData.orgName = record.org_name;
      jobData.orgDescription = '';
    } else if (queueName === QUEUE_NAMES.QUALIFICATION) {
      jobData.companyNumber = record.company_number;
      jobData.companyName = record.company_name;
      jobData.orgName = record.org_name;
      jobData.orgDescription = '';
    } else if (queueName === QUEUE_NAMES.EMAIL_GENERATION) {
      jobData.companyNumber = record.company_number;
      jobData.companyName = record.company_name;
      jobData.orgName = record.org_name;
      jobData.orgDescription = '';
      jobData.scoring = {
        capexiqScore: record.capexiq_score,
        ppeScore: record.ppe_score,
        sicScore: record.sic_score,
        investmentActivityScore: record.investment_activity_score,
        assetIntensityScore: record.asset_intensity_score,
        ppeCategory: record.ppe_category,
        opportunityValue: record.opportunity_value,
        indicators: record.ca_indicators || [],
      };
      jobData.caAnalysis = record.ca_analysis
        ? (typeof record.ca_analysis === 'string' ? JSON.parse(record.ca_analysis) : record.ca_analysis)
        : null;
      jobData.financials = record.financials
        ? (typeof record.financials === 'string' ? JSON.parse(record.financials) : record.financials)
        : {};
      jobData.extracted = {};
    } else if (queueName === QUEUE_NAMES.GHL_SEND) {
      // ghl-send just needs companyId and runId (already set above)
    }

    await updateCompanyStatus(record.id, 'pending', {
      retry_count: (record.retry_count || 0) + 1,
      error_log: null,
    });

    await queue.add('cron-retry', jobData, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });

    retried++;
  }

  console.log(`[cron] Retried ${retried} failed jobs`);
  return retried;
}

async function sendDailySummary() {
  const webhookEnabled = await getSetting('webhook_enabled');
  const webhookUrl = await getSetting('webhook_url');

  if (webhookEnabled !== 'true' || !webhookUrl) {
    console.log('[cron] Webhook disabled or no URL configured. Skipping summary.');
    return;
  }

  // Gather stats
  const sentToday = await getSentTodayCount();

  const readyResult = await query<{ count: number }>(
    "SELECT count(*)::int as count FROM processed_companies WHERE status = 'ready_to_send'"
  );
  const readyToSend = readyResult.rows[0].count;

  const failedTodayResult = await query<{ count: number }>(
    "SELECT count(*)::int as count FROM processed_companies WHERE status LIKE 'failed_%' AND created_at::date = CURRENT_DATE"
  );
  const failedToday = failedTodayResult.rows[0].count;

  const totalFailedResult = await query<{ count: number }>(
    "SELECT count(*)::int as count FROM processed_companies WHERE status LIKE 'failed_%'"
  );
  const totalFailed = totalFailedResult.rows[0].count;

  const processedTodayResult = await query<{ count: number }>(
    "SELECT count(*)::int as count FROM processed_companies WHERE created_at::date = CURRENT_DATE"
  );
  const processedToday = processedTodayResult.rows[0].count;

  const payload = buildDailySummary({
    processedToday,
    sentToday,
    readyToSend,
    failedToday,
    totalFailed,
  });

  await sendNotification(payload, webhookUrl);
}

// Main cron execution
async function run() {
  console.log(`[cron] Starting cron run at ${new Date().toISOString()}`);

  await runMigrations();

  // 1. Daily GHL send
  const sent = await dailyGHLSend();

  // 2. Retry failed jobs
  const retried = await retryFailedJobs();

  // 3. Send daily summary
  await sendDailySummary();

  console.log(`[cron] Cron run complete. Sent: ${sent}, Retried: ${retried}`);
}

run()
  .then(() => {
    // Give a moment for any queue operations to flush
    setTimeout(() => process.exit(0), 2000);
  })
  .catch((err) => {
    console.error('[cron] Cron run failed:', err);
    process.exit(1);
  });
